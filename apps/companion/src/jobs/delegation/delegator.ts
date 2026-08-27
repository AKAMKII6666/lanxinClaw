/**
 * JobDelegator：权限批准后自动委派 adapter 并回推 job 状态给 phone。
 *
 * 职责：permission.decide 成功后，校验授予、创建 OpenClaw run、广播 job.accepted，
 * 随后轮询 adapter 状态变化并广播 job.progress/completed/blocked/failed。
 * 不拥有：权限裁决权威（在 gate）、affair 关闭、真实 Gateway 配置。
 * 副作用：调用 adapter（可能网络 I/O）、定时轮询、经 apply/send 更新 backend 与 phone。
 */

import {
  createEnvelope,
  type AffairPayload,
  type JobPayload,
  type JobStatus,
  type PermissionId,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import { OpenClawAdapter } from "@lanxin-claw/openclaw-adapter";
import type { Logger } from "pino";
import type { PermissionGate } from "../../permissions/gate/permission-gate.js";
import type { ApplyProtocolResult } from "../../state/types.js";
import { resolveAuthorizedWorkspaceRoot } from "../workspace-scope.js";
import { statusToEnvelopeType, toJobPayload } from "./delegator-payload.js";

/** 默认轮询间隔毫秒 */
export const DEFAULT_JOB_POLL_INTERVAL_MS = 2_000;

/** 终态：停止轮询 */
const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["completed", "failed", "canceled"];

/** in-flight 占位（createJob 完成前） */
const IN_FLIGHT_PLACEHOLDER = Symbol("in_flight");

/** 委派器依赖 */
export interface JobDelegatorDeps {
  /** 已注入 runtime 的 adapter */
  adapter: OpenClawAdapter;
  /** 桌面授权权威 */
  gate: PermissionGate;
  /** 读协议侧 job 当前状态（backend state） */
  getJobStatus: (jobId: string) => string | undefined;
  /** 读 job 的 workspaceHint，用于授权根校验 */
  getWorkspaceHint?: (jobId: string) => string | null | undefined;
  /** 桌面授权工作区根；越界拒绝委派 */
  authorizedDesktopRoot?: string | null;
  /** 读 affair 当前状态（backend state；投影广播用） */
  getAffair?: (affairId: string) => AffairPayload | undefined;
  /** 已配对电话设备 id（outbound target）；无配对时跳过 WS send */
  getPhoneDeviceId: () => string | null;
  /** 桌面设备 id（outbound source） */
  desktopDeviceId: string;
  /** apply 到 backend */
  applyProtocolEnvelope: (envelope: ProtocolEnvelope<any>) => ApplyProtocolResult;
  /** 仅 WS 发送（backend 已 apply） */
  sendEnvelope: (envelope: ProtocolEnvelope<any>) => void;
  /** 轮询间隔毫秒；默认 2000 */
  pollIntervalMs?: number;
  /** 日志；可选 */
  logger?: Logger;
}

/** 活跃轮询项 */
interface ActivePoll {
  /** 上次已广播状态 */
  lastStatus: JobStatus;
  /** 轮询定时器 */
  timer: NodeJS.Timeout;
}

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
      this.broadcastJobFailure(jobId, affairId, "job 缺少 allowedPermissions，不得委派");
      return;
    }
    const ungranted = request.requestedPermissions.find(
      (permissionId) => !this.deps.gate.hasGrant(jobId, permissionId as PermissionId),
    );
    if (ungranted) {
      this.deps.logger?.warn({ jobId, permissionId: ungranted }, "权限未授予，拒绝委派");
      this.broadcastJobFailure(jobId, affairId, `权限 ${ungranted} 未有效授予`);
      return;
    }
    const scoped = resolveAuthorizedWorkspaceRoot(
      request.proposedScope.workspaceRoot,
      this.deps.getWorkspaceHint?.(jobId) ?? request.proposedScope.workspaceRoot ?? null,
      this.deps.authorizedDesktopRoot ?? null,
    );
    if (!scoped.ok) {
      this.deps.logger?.warn({ jobId, code: scoped.code }, "工作区越界，拒绝委派");
      this.broadcastJobFailure(jobId, affairId, scoped.message);
      return;
    }

    this.active.set(jobId, IN_FLIGHT_PLACEHOLDER);

    const created = await this.deps.adapter.createJob({
      jobId,
      affairId,
      goal: request.reason,
      workspaceHint: scoped.workspaceRoot,
      allowedPermissions: [...request.requestedPermissions],
    });
    if (!created.ok) {
      this.active.delete(jobId);
      this.deps.logger?.warn({ jobId, code: created.code }, "adapter 委派失败");
      this.broadcastJobFailure(jobId, affairId, created.message);
      return;
    }

    for (const permissionId of request.requestedPermissions) {
      this.deps.gate.isGranted(jobId, permissionId as PermissionId);
    }

    this.broadcastJobAccepted(created.job, created.job.status);
    this.projectAffair(created.job.affairId);
    const poll = this.startPolling(jobId, created.job.status);
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
    this.broadcastJobFailure(jobId, affairId, reason.trim() || "permission_denied");
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
      if (status !== "queued" && status !== "running" && status !== "blocked") {
        continue;
      }
      const read = await this.deps.adapter.readJob(jobId, { refresh: true });
      if (!read.ok) {
        continue;
      }
      const poll = this.startPolling(jobId, read.job.status);
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
    this.broadcastJobAccepted(read.job, read.job.status);
    this.projectAffair(affairId);
    const poll = this.startPolling(jobId, read.job.status);
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
  setAdapter(next: OpenClawAdapter): void {
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
    this.broadcastJobStatus(input.jobId, result.job.status, result.job);
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
   * @param initialStatus 初始状态
   * @returns 轮询项
   */
  private startPolling(jobId: string, initialStatus: JobStatus): ActivePoll {
    const timer = setInterval(() => {
      void this.pollJob(jobId);
    }, this.deps.pollIntervalMs ?? DEFAULT_JOB_POLL_INTERVAL_MS);
    return { lastStatus: initialStatus, timer };
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
    const read = await this.deps.adapter.readJob(jobId, { refresh: true });
    if (!read.ok) {
      this.deps.logger?.warn({ jobId, code: read.code }, "adapter 读取失败");
      if (!read.retryable) {
        this.stopPolling(jobId);
      }
      return;
    }
    if (read.job.status === poll.lastStatus) {
      return;
    }
    this.broadcastJobStatus(read.job.jobId, read.job.status, read.job);
    poll.lastStatus = read.job.status;
    this.projectAffair(read.job.affairId);
    if (TERMINAL_JOB_STATUSES.includes(read.job.status)) {
      this.stopPolling(jobId);
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
   * 广播 job.accepted。
   *
   * @param job adapter job 快照
   * @param status 状态
   */
  private broadcastJobAccepted(
    job: {
      jobId: string;
      affairId: string;
      goal: string;
      workspaceHint?: string | null;
      allowedPermissions: readonly string[];
      progressSummary: string;
      blockedReason: string | null;
      resumeCondition: string | null;
    },
    status: JobStatus,
  ): void {
    this.applyAndMaybeSend(
      createEnvelope({
        source: { kind: "companion", deviceId: this.deps.desktopDeviceId },
        target: { kind: "phone", deviceId: this.deps.getPhoneDeviceId() ?? "unknown" },
        type: "job.accepted",
        payload: toJobPayload(job, status),
      }),
    );
  }

  /**
   * 广播 job 状态 envelope（先 apply 到 backend，再按需发给 phone）。
   *
   * @param jobId job id
   * @param status 状态
   * @param job adapter job 快照
   */
  private broadcastJobStatus(
    jobId: string,
    status: JobStatus,
    job: {
      jobId: string;
      affairId: string;
      goal: string;
      workspaceHint?: string | null;
      allowedPermissions: readonly string[];
      progressSummary: string;
      blockedReason: string | null;
      resumeCondition: string | null;
      permissionRequestId?: string | null;
    },
  ): void {
    const payload = toJobPayload(job, status);
    const type = statusToEnvelopeType(status);
    this.applyAndMaybeSend(
      createEnvelope({
        source: { kind: "companion", deviceId: this.deps.desktopDeviceId },
        target: { kind: "phone", deviceId: this.deps.getPhoneDeviceId() ?? "unknown" },
        type,
        payload,
      }),
    );
  }

  /**
   * 广播委派失败为 job.failed。
   *
   * @param jobId job id
   * @param affairId affair id
   * @param message 失败原因
   */
  private broadcastJobFailure(jobId: string, affairId: string, message: string): void {
    this.broadcastJobStatus(
      jobId,
      "failed",
      {
        jobId,
        affairId,
        goal: message.trim() || "delegation_failed",
        workspaceHint: null,
        allowedPermissions: [],
        progressSummary: message,
        blockedReason: message,
        resumeCondition: null,
      },
    );
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
    this.applyAndMaybeSend(
      createEnvelope({
        source: { kind: "companion", deviceId: this.deps.desktopDeviceId },
        target: { kind: "phone", deviceId: this.deps.getPhoneDeviceId() ?? "unknown" },
        type: "affair.update",
        payload: affair,
      }),
    );
  }
}
