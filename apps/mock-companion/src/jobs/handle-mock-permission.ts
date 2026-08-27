/**
 * Mock 桌面权限决策：grant/deny 后闭环 job 状态并可选启动 worker。
 *
 * 职责：模拟 companion 桌面 permission.decide 对 job 的推进。
 * 不拥有：真实 PermissionGate、OpenClaw 执行、持久化。
 * 副作用：更新 store、emit 协议出站；grant 时 fire-and-forget mock worker。
 */

import {
  canTransitionJobStatus,
  createEnvelope,
  createProtocolError,
  type JobPayload,
  type ProtocolError,
} from "@lanxin-claw/protocol";
import type { MockCompanionConfig } from "../config.js";
import type { EmitEnvelope } from "../pairing/handle-pairing.js";
import { startMockWorker } from "./mock-worker.js";
import type { MemoryStore } from "../store/memory-store.js";
import { validateMockWorkspaceScope } from "../scope/workspace-scope.js";

/**
 * 权限决策处理结果。
 */
export type MockPermissionDecisionResult = { ok: true } | { ok: false; error: ProtocolError };

/**
 * 应用 mock 桌面权限决策。
 *
 * @param store 内存 store
 * @param config 配置
 * @param input permissionRequestId 与 decision
 * @param emit 出站回调
 * @returns 处理结果
 */
export function applyMockPermissionDecision(
  store: MemoryStore,
  config: MockCompanionConfig,
  input: { permissionRequestId: string; decision: string },
  emit: EmitEnvelope,
): MockPermissionDecisionResult {
  if (!store.session) {
    return {
      ok: false,
      error: createProtocolError("session_required", "权限决策须已建立 session", false),
    };
  }
  const item = store.permissionItems.find(
    (entry) =>
      entry.permissionRequestId === input.permissionRequestId && entry.queueStatus === "pending",
  );
  if (!item?.jobId) {
    return {
      ok: false,
      error: createProtocolError("permission_not_found", "找不到待决权限请求", false, {
        permissionRequestId: input.permissionRequestId,
      }),
    };
  }
  const jobId = item.jobId;
  const job = store.jobs.get(jobId);
  if (!job || job.status !== "needs_permission") {
    return {
      ok: false,
      error: createProtocolError("job_illegal_transition", "job 不在 needs_permission", false, {
        jobId,
        status: job?.status ?? null,
      }),
    };
  }

  item.queueStatus = "resolved";
  const phoneDeviceId = store.session.phoneDeviceId;
  const party = {
    source: { kind: "companion" as const, deviceId: config.desktopDeviceId },
    target: { kind: "phone" as const, deviceId: phoneDeviceId },
  };
  const decidedAt = new Date().toISOString();
  emit(
    createEnvelope({
      ...party,
      type: "permission.decision",
      payload: {
        permissionRequestId: input.permissionRequestId,
        jobId,
        decision: input.decision,
        decidedAt,
      },
    }),
  );

  if (input.decision === "deny" || input.decision === "require_more_context") {
    const failed = transitionJob(job, "failed");
    store.jobs.set(jobId, {
      ...failed,
      progressSummary: input.decision === "deny" ? "用户拒绝授权" : "需要更多上下文",
      blockedReason: input.decision === "deny" ? "permission_denied" : "require_more_context",
    });
    emit(
      createEnvelope({
        ...party,
        type: "job.failed",
        payload: store.jobs.get(jobId)!,
      }),
    );
    return { ok: true };
  }

  const authorizedRoot = process.env.MOCK_COMPANION_WORKSPACE_ROOT?.trim() || process.cwd();
  const proposedRoot = (item as { proposedScope?: { workspaceRoot?: string } }).proposedScope?.workspaceRoot
    ?? job.workspaceHint
    ?? undefined;
  if (!validateMockWorkspaceScope(proposedRoot ?? undefined, authorizedRoot)) {
    return {
      ok: false,
      error: createProtocolError("workspace_scope_mismatch", "工作区超出 mock 授权根", false, { jobId }),
    };
  }

  const running = transitionJob(job, "running");
  store.jobs.set(jobId, {
    ...running,
    progressSummary: "mock 桌面已授权，准备执行",
  });
  emit(
    createEnvelope({
      ...party,
      type: "job.accepted",
      payload: store.jobs.get(jobId)!,
    }),
  );
  startMockWorker(store, config, jobId, phoneDeviceId, jobId, emit);
  return { ok: true };
}

/**
 * 安全迁移 job 状态。
 *
 * @param job 当前 job
 * @param to 目标状态
 * @returns 更新后的 job
 */
function transitionJob(job: JobPayload, to: JobPayload["status"]): JobPayload {
  if (!canTransitionJobStatus(job.status, to)) {
    return job;
  }
  return { ...job, status: to };
}
