/**
 * JobDelegator：权限批准后自动委派 adapter 并回推 job 状态给 phone。
 *
 * 职责：permission.decide 成功后，校验授予、创建 OpenClaw run、广播 job.accepted，
 * 随后轮询 adapter 状态变化并广播 job.progress/completed/blocked/failed。
 * 不拥有：权限裁决权威（在 gate）、affair 关闭、真实 Gateway 配置。
 * 副作用：调用 adapter（可能网络 I/O）、定时轮询、经 apply/send 更新 backend 与 phone。
 */

import { type JobStatus, type PermissionId, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { AdapterJobRecord } from "@lanxin-claw/openclaw-adapter";
import { resolveAuthorizedWorkspaceRoot } from "../workspace-scope.js";
import { statusToEnvelopeType } from "./delegator-payload.js";
import {
  buildAffairUpdateEnvelope,
  buildDelegationFailureJob,
  buildJobEnvelope,
  buildRuntimeReadFailureJob,
  type DelegationFailureContext,
  type DelegatorJobProjection,
} from "./projection/delegator-outbound.js";
import { failureContextForRequest, outboundIdentityFromDeps } from "./delegator-context.js";
import { jobStatusFingerprint } from "./projection/job-status-fingerprint.js";
import { canExecutePermissionGrantedJob } from "./permission-execution-precheck.js";
import {
  DEFAULT_JOB_POLL_INTERVAL_MS,
  IN_FLIGHT_PLACEHOLDER,
  POLL_STOP_JOB_STATUSES,
  type ActivePoll,
  type JobDelegatorDeps,
} from "./delegator-types.js";

export { DEFAULT_JOB_POLL_INTERVAL_MS };
export type { JobDelegatorDeps } from "./delegator-types.js";

/**
 * Job 委派器实例。
 */
export class JobDelegator {
  private readonly deps: JobDelegatorDeps;
  private readonly active = new Map<string, ActivePoll | typeof IN_FLIGHT_PLACEHOLDER>();
  private readonly affairLastStatus = new Map<string, string>();

  /**
   * @param deps 依赖
   */
  constructor(deps: JobDelegatorDeps) {
    this.deps = deps;
  }

  /**
   * permission.decide 成功后的委派入口（幂等）。
   *
   * @param permissionRequestId 权限请求 id
   * @returns 完成
   */
  async handlePermissionGranted(permissionRequestId: string): Promise<void> {
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

    const created = await this.deps.adapter.createJob({
      jobId,
      affairId,
      goal: request.reason,
      purpose: this.deps.getJobPurpose?.(jobId) ?? "execution",
      workspaceHint: scoped.workspaceRoot,
      allowedPermissions: [...request.requestedPermissions],
    });
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

    this.broadcastJobAfterCreate(created.job);
    this.projectAffair(created.job.affairId);
    if (POLL_STOP_JOB_STATUSES.includes(created.job.status)) {
      this.active.delete(jobId);
      this.deps.logger?.info({ jobId, runId: created.job.openclawRunId }, "job 已委派 OpenClaw 并进入停止轮询状态");
      return;
    }
    const poll = this.startPolling(jobId, created.job);
    this.active.set(jobId, poll);
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
    for (const jobId of jobIds) {
      if (this.active.has(jobId)) {
        continue;
      }
      const status = this.deps.getJobStatus(jobId);
      if (status !== "queued" && status !== "running") {
        continue;
      }
      const read = await this.deps.adapter.readJob(jobId, { refresh: true });
      if (!read.ok) {
        continue;
      }
      this.broadcastJobStatus(read.job.status, read.job);
      this.projectAffair(read.job.affairId);
      if (POLL_STOP_JOB_STATUSES.includes(read.job.status)) {
        continue;
      }
      const poll = this.startPolling(jobId, read.job);
      this.active.set(jobId, poll);
      this.deps.logger?.info({ jobId, status: read.job.status }, "已恢复 job 轮询");
    }
  }

  /**
   * adapter 已有 run 但 backend 仍 needs_permission：补 accepted 并开始轮询。
   *
   * @param jobId job id
   * @param affairId affair id
   */
  async reconcileExistingAdapterRun(jobId: string, affairId: string): Promise<void> {
    if (this.active.has(jobId)) {
      return;
    }
    if (this.deps.getJobStatus(jobId) !== "needs_permission") {
      return;
    }
    const read = await this.deps.adapter.readJob(jobId, { refresh: true });
    if (!read.ok) {
      return;
    }
    this.broadcastJobAfterCreate(read.job);
    this.projectAffair(affairId);
    if (POLL_STOP_JOB_STATUSES.includes(read.job.status)) {
      return;
    }
    const poll = this.startPolling(jobId, read.job);
    this.active.set(jobId, poll);
    this.deps.logger?.info({ jobId, status: read.job.status }, "reconcile：恢复 adapter run 轮询");
  }

  /**
   * 停止全部轮询（关闭 app 时调用）。
   */
  stop(): void {
    for (const poll of this.active.values()) {
      if (poll !== IN_FLIGHT_PLACEHOLDER) {
        clearInterval(poll.timer);
      }
    }
    this.active.clear();
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
    const result = await this.deps.adapter.cancelJob(input.jobId);
    if (!result.ok) {
      this.deps.logger?.warn({ jobId: input.jobId, code: result.code }, "adapter 取消失败");
      throw new Error(result.message);
    }
    this.broadcastJobStatus(result.job.status, result.job);
    this.stopPolling(input.jobId);
    this.projectAffair(input.affairId);
    this.deps.logger?.info({ jobId: input.jobId, status: result.job.status }, "job 已取消");
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
   * 启动 job 轮询。
   *
   * @param jobId job id
   * @param initialJob 初始 job
   * @returns 轮询项
   */
  private startPolling(jobId: string, initialJob: AdapterJobRecord): ActivePoll {
    const timer = setInterval(() => {
      void this.pollJob(jobId);
    }, this.deps.pollIntervalMs ?? DEFAULT_JOB_POLL_INTERVAL_MS);
    return {
      lastFingerprint: jobStatusFingerprint(initialJob),
      lastJob: initialJob,
      inFlight: false,
      timer,
    };
  }

  /**
   * 轮询一次 job 状态并广播变化。
   *
   * @param jobId job id
   * @returns 完成
   */
  private async pollJob(jobId: string): Promise<void> {
    const poll = this.active.get(jobId);
    if (!poll || poll === IN_FLIGHT_PLACEHOLDER) {
      return;
    }
    if (poll.inFlight) {
      return;
    }
    poll.inFlight = true;
    try {
      const read = await this.deps.adapter.readJob(jobId, { refresh: true });
      if (this.active.get(jobId) !== poll) {
        return;
      }
      if (!read.ok) {
        this.deps.logger?.warn({ jobId, code: read.code }, "adapter 读取失败");
        if (!read.retryable) {
          const failedJob = buildRuntimeReadFailureJob(poll.lastJob, read.message, read.code);
          this.broadcastJobStatus("failed", failedJob);
          this.projectAffair(failedJob.affairId);
          this.stopPolling(jobId);
        }
        return;
      }
      const nextFingerprint = jobStatusFingerprint(read.job);
      poll.lastJob = read.job;
      if (nextFingerprint === poll.lastFingerprint) {
        return;
      }
      this.broadcastJobStatus(read.job.status, read.job);
      poll.lastFingerprint = nextFingerprint;
      this.projectAffair(read.job.affairId);
      if (POLL_STOP_JOB_STATUSES.includes(read.job.status)) {
        this.stopPolling(jobId);
      }
    } finally {
      poll.inFlight = false;
    }
  }

  /**
   * 停止单个 job 轮询。
   *
   * @param jobId job id
   */
  private stopPolling(jobId: string): void {
    const poll = this.active.get(jobId);
    if (poll && poll !== IN_FLIGHT_PLACEHOLDER) {
      clearInterval(poll.timer);
    }
    this.active.delete(jobId);
  }

  /**
   * apply backend 并按需 send phone。
   *
   * @param envelope 协议 envelope
   */
  private applyAndMaybeSend(envelope: ProtocolEnvelope<any>): void {
    const applied = this.deps.applyProtocolEnvelope(envelope);
    if (!applied.ok) {
      this.deps.logger?.warn({ type: envelope.type, code: applied.code }, "delegator apply 失败");
      return;
    }
    if (this.deps.getPhoneDeviceId()) {
      this.deps.sendEnvelope(envelope);
    }
  }

  /**
   * create/reconcile 后按当前 job 状态选择正确 envelope。
   *
   * @param job adapter job 快照
   */
  private broadcastJobAfterCreate(job: AdapterJobRecord): void {
    if (job.status === "queued" || job.status === "running") {
      this.broadcastJobAccepted(job, job.status);
      return;
    }
    this.broadcastJobStatus(job.status, job);
  }

  /**
   * 广播 job.accepted。
   *
   * @param job adapter job 快照
   * @param status 状态
   */
  private broadcastJobAccepted(
    job: DelegatorJobProjection,
    status: JobStatus,
  ): void {
    this.applyAndMaybeSend(
      buildJobEnvelope({
        identity: this.outboundIdentity(),
        type: "job.accepted",
        status,
        job,
      }),
    );
  }

  /**
   * 广播 job 状态 envelope（先 apply 到 backend，再按需发给 phone）。
   *
   * @param status 状态
   * @param job adapter job 快照
   */
  private broadcastJobStatus(
    status: JobStatus,
    job: DelegatorJobProjection,
  ): void {
    this.applyAndMaybeSend(
      buildJobEnvelope({
        identity: this.outboundIdentity(),
        type: statusToEnvelopeType(status),
        status,
        job,
      }),
    );
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
    this.broadcastJobStatus("failed", buildDelegationFailureJob(jobId, affairId, message, code, context));
  }

  /**
   * affair 投影变化时广播 affair.update（companion → phone）。
   *
   * @param affairId affair id
   */
  private projectAffair(affairId: string): void {
    const affair = this.deps.getAffair?.(affairId);
    if (!affair) {
      return;
    }
    const last = this.affairLastStatus.get(affairId);
    if (last === affair.status) {
      return;
    }
    this.affairLastStatus.set(affairId, affair.status);
    this.applyAndMaybeSend(buildAffairUpdateEnvelope(this.outboundIdentity(), affair));
  }

  private outboundIdentity() {
    return outboundIdentityFromDeps(this.deps);
  }
}
