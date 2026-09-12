/**
 * JobDelegator：权限批准后自动委派 adapter 并回推 job 状态给 phone。
 *
 * 职责：permission.decide 成功后，校验授予、创建 OpenClaw run、广播 job.accepted，
 * 随后轮询 adapter 状态变化并广播 job.progress/completed/blocked/failed。
 * 不拥有：权限裁决权威（在 gate）、affair 关闭、真实 Gateway 配置。
 * 副作用：调用 adapter（可能网络 I/O）、定时轮询、经 apply/send 更新 backend 与 phone。
 */
import { JobPolling } from "./polling/job-polling.js";


import { type PermissionId } from "@lanxin-claw/protocol";
import { resolveAuthorizedWorkspaceRoot } from "../workspace-scope.js";
import { failureContextForRequest } from "./delegator-context.js";
import {
DEFAULT_JOB_POLL_INTERVAL_MS,
IN_FLIGHT_PLACEHOLDER,
type ActivePoll,
type JobDelegatorDeps
} from "./delegator-types.js";
import { canExecutePermissionGrantedJob } from "./permission-execution-precheck.js";
import {
buildDelegationFailureJob,
type DelegationFailureContext
} from "./projection/delegator-outbound.js";
import { JobStatusPublisher } from "./projection/job-status-publisher.js";

export type { JobDelegatorDeps } from "./delegator-types.js";
export { DEFAULT_JOB_POLL_INTERVAL_MS };

/**
 * Job 委派器实例。
 */
export class JobDelegator {
  private readonly deps: JobDelegatorDeps;
  private readonly active = new Map<string, ActivePoll | typeof IN_FLIGHT_PLACEHOLDER>();
  private readonly publisher: JobStatusPublisher;
  private readonly polling: JobPolling;

  /**
   * @param deps 依赖
   */
  constructor(deps: JobDelegatorDeps) {
    this.deps = deps;
    this.publisher = new JobStatusPublisher(deps);
    this.polling = new JobPolling(deps, this.active, this.publisher);
  }

  /**
   * permission.decide 成功后的委派入口（幂等）。
   *
   * @param permissionRequestId 权限请求 id
   * @returns 完成
   */
  async handlePermissionGranted(permissionRequestId: string): Promise<void> {
    const affairId = this.deps.gate.getRequest(permissionRequestId)?.affairId ?? "";
    if (this.deps.runAffairOperation) {
      return this.deps.runAffairOperation(affairId, () => this.delegateGranted(permissionRequestId));
    }
    return this.delegateGranted(permissionRequestId);
  }

  private async delegateGranted(permissionRequestId: string): Promise<void> {
    const request = this.deps.gate.getRequest(permissionRequestId);
    if (!request?.jobId) {
      return;
    }
    const jobId = request.jobId;
    const affairId = request.affairId ?? "";
    const failureContext = failureContextForRequest(this.deps, request);
    if (!canExecutePermissionGrantedJob(this.deps, affairId, jobId)) {
      return;
    }
    if (this.active.has(jobId)) {
      this.deps.logger?.debug({ jobId }, "job 已在委派/轮询中，忽略重复决策");
      return;
    }
    if (this.deps.getJobStatus(jobId) !== "needs_permission") {
      this.deps.logger?.debug({ jobId, status: this.deps.getJobStatus(jobId) }, "job 不在 needs_permission，跳过委派");
      return;
    }
    if (request.requestedPermissions.length === 0) {
      this.deps.logger?.warn({ jobId }, "空权限列表，拒绝委派");
      this.broadcastJobFailure(
        jobId,
        affairId,
        "job 缺少 allowedPermissions，不得委派",
        "lanxin.empty_permissions",
        failureContext,
      );
      return;
    }
    const ungranted = request.requestedPermissions.find(
      (permissionId) => !this.deps.gate.hasGrant(jobId, permissionId as PermissionId),
    );
    if (ungranted) {
      this.deps.logger?.warn({ jobId, permissionId: ungranted }, "权限未授予，拒绝委派");
      this.broadcastJobFailure(
        jobId,
        affairId,
        `权限 ${ungranted} 未有效授予`,
        "lanxin.permission_not_granted",
        failureContext,
      );
      return;
    }
    const scoped = resolveAuthorizedWorkspaceRoot(
      request.proposedScope.workspaceRoot,
      this.deps.getWorkspaceHint?.(jobId) ?? request.proposedScope.workspaceRoot ?? null,
      this.deps.authorizedDesktopRoot ?? null,
    );
    if (!scoped.ok) {
      this.deps.logger?.warn({ jobId, code: scoped.code }, "工作区越界，拒绝委派");
      this.broadcastJobFailure(jobId, affairId, scoped.message, scoped.code, failureContext);
      return;
    }

    this.active.set(jobId, IN_FLIGHT_PLACEHOLDER);

    let created;
    try {
      created = await this.deps.adapter.createJob({
      jobId,
      affairId,
      goal: request.reason,
      purpose: this.deps.getJobPurpose?.(jobId) ?? "execution",
      workspaceHint: scoped.workspaceRoot,
      allowedPermissions: [...request.requestedPermissions],
      });
    } catch (error) {
      this.active.delete(jobId);
      throw error;
    }
    if (!created.ok) {
      this.active.delete(jobId);
      this.deps.logger?.warn({ jobId, code: created.code }, "adapter 委派失败");
      this.broadcastJobFailure(
        jobId,
        affairId,
        created.message,
        created.code,
        failureContextForRequest(this.deps, request, scoped.workspaceRoot),
      );
      return;
    }

    for (const permissionId of request.requestedPermissions) {
      this.deps.gate.isGranted(jobId, permissionId as PermissionId);
    }

    if (!canExecutePermissionGrantedJob(this.deps, affairId, jobId)) {
      this.publisher.publishCreated(created.job);
      this.active.delete(jobId);
      await this.cancelJob({ jobId, affairId });
      return;
    }
    this.polling.accept(created.job);
    this.deps.logger?.info({ jobId, runId: created.job.openclawRunId }, "job 已委派 OpenClaw");
  }

  /**
   * 用户拒绝或要求更多上下文：广播 job.failed 并停止 needs_permission。
   *
   * @param permissionRequestId 权限请求 id
   * @param reason 失败原因
   */
  rejectPermission(permissionRequestId: string, reason: string): void {
    const request = this.deps.gate.getRequest(permissionRequestId);
    if (!request?.jobId) {
      return;
    }
    const jobId = request.jobId;
    const affairId = request.affairId ?? "";
    if (this.deps.getJobStatus(jobId) !== "needs_permission") {
      return;
    }
    this.broadcastJobFailure(
      jobId,
      affairId,
      reason.trim() || "permission_denied",
      "lanxin.permission_denied",
      failureContextForRequest(this.deps, request),
    );
  }

  /**
   * Companion 重启后恢复 in-flight job 轮询（不重新 createRun）。
   *
   * @param jobIds 待恢复的 job id 列表
   */
  async restoreInFlightPolling(jobIds: readonly string[]): Promise<void> {
    for (const jobId of jobIds) await this.polling.restore(jobId);
  }

  /**
   * adapter 已有 run 但 backend 仍 needs_permission：补 accepted 并开始轮询。
   *
   * @param jobId job id
   * @param affairId affair id
   */
  async reconcileExistingAdapterRun(jobId: string, affairId: string): Promise<void> {
    const job = this.deps.getJob?.(jobId);
    if (job && job.affairId !== affairId) return;
    await this.polling.restore(jobId);
  }

  /**
   * 停止全部轮询（关闭 app 时调用）。
   */
  stop(): void {
    this.polling.stopAll();
  }

  /**
   * 替换执行引擎（local-safe → 自托管 gateway 就绪后）。
   *
   * @param next 新 adapter
   */
  setAdapter(next: JobDelegatorDeps["adapter"]): void {
    this.deps.adapter = next;
  }

  /**
   * 取消 job：请求 adapter 取消 run，广播取消结果并停轮询。
   *
   * @param input job 与 affair
   * @returns 完成；adapter 取消失败时抛错
   */
  async cancelJob(input: { jobId: string; affairId: string }): Promise<void> {
    const local = this.deps.getJob?.(input.jobId);
    if (local && local.affairId !== input.affairId) throw new Error("job 不属于目标事务");
    const registered = await this.deps.adapter.readJob(input.jobId, { refresh: false });
    if (!registered.ok && registered.code === "job_not_found" && local &&
        ["queued", "needs_permission"].includes(local.status) && !this.active.has(input.jobId)) {
      if (!this.publisher.publish("canceled", { ...local, progressSummary: local.progressSummary ?? "运行前取消", blockedReason: null, resumeCondition: null, statusReasonCode: "lanxin.cancel_before_run" })) {
        throw new Error("本地取消事实未能提交");
      }
      this.publisher.projectAffair(input.affairId);
      return;
    }
    const result = await this.deps.adapter.cancelJob(input.jobId);
    if (!result.ok) throw new Error(result.message);
    if (!["completed", "failed", "canceled"].includes(result.job.status)) {
      this.polling.accept(result.job);
      throw new Error("执行器只接受了取消请求，尚未提供停止证据");
    }
    if (!this.polling.accept(result.job)) throw new Error("取消结果未能提交到 companion");
    this.deps.logger?.info({ jobId: input.jobId, status: result.job.status }, "job 已确认停止");
  }

  /**
   * 活跃轮询数（诊断/测试）。
   *
   * @returns 数量
   */
  activeJobCount(): number {
    return this.active.size;
  }

  /**
   * 列出活跃 job id（revoke 前取消用）。
   *
   * @returns job id 列表
   */
  listActiveJobIds(): string[] {
    return [...this.active.keys()];
  }

  /**
   * 广播委派失败为 job.failed。
   *
   * @param jobId job id
   * @param affairId affair id
   * @param message 失败原因
   * @param code 稳定错误码
   */
  private broadcastJobFailure(
    jobId: string,
    affairId: string,
    message: string,
    code?: string,
    context?: DelegationFailureContext,
  ): void {
    this.polling.fail(buildDelegationFailureJob(jobId, affairId, message, code, context));
  }

}
