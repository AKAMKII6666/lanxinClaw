/**
 * Affair / job 入站处理。
 *
 * 职责：校验会话后接受 affair.create / job.create，出站 needs_permission 并等待 mock 桌面授权。
 * 不拥有：用户验收关闭事务、真实 OpenClaw 执行。
 * 副作用：更新 store；emit 协议事件；异步调度 mock worker。
 */

import {
  canTransitionAffairStatus,
  createEnvelope,
  createProtocolError,
  type AffairPayload,
  type JobPayload,
  type ProtocolEnvelope,
  type ProtocolError,
} from "@lanxin-claw/protocol";
import type { MockCompanionConfig } from "../config.js";
import type { EmitEnvelope } from "../pairing/handle-pairing.js";
import type { MemoryStore } from "../store/memory-store.js";

/**
 * 处理结果。
 */
export type AffairJobHandleResult = { ok: true } | { ok: false; error: ProtocolError };

/**
 * 要求已建立 session。
 *
 * @param store 内存 store
 * @returns 错误或 null
 */
function requireSession(store: MemoryStore): ProtocolError | null {
  if (!store.session) {
    return createProtocolError("session_required", "需要先完成 pairing 与 session.open", false);
  }
  return null;
}

const KNOWN_PERMISSIONS = [
  "workspace.read",
  "workspace.write",
  "command.run",
  "network.access",
  "git.read",
  "git.write",
  "secrets.read",
  "desktop.control",
] as const;

/**
 * 过滤已知权限 id。
 *
 * @param items 原始列表
 * @returns 已知权限
 */
function filterKnownPermissions(items: readonly string[]): string[] {
  return items.filter((item) => (KNOWN_PERMISSIONS as readonly string[]).includes(item));
}

/**
 * exploration job 只用于对话澄清期探测，不推进 affair 生命周期。
 *
 * @param job job 载荷
 * @returns 是否为探索 job
 */
function isExplorationJob(job: JobPayload): boolean {
  return job.purpose === "exploration";
}

/**
 * 出站 permission.request、job.needs_permission。
 *
 * @param store store
 * @param config 配置
 * @param inbound 入站
 * @param needsPermission 状态为 needs_permission 的 job 载荷
 * @param allowed 权限
 * @param emit 出站
 */
function emitJobCreateOutbound(
  store: MemoryStore,
  config: MockCompanionConfig,
  inbound: ProtocolEnvelope,
  needsPermission: JobPayload,
  allowed: string[],
  emit: EmitEnvelope,
): void {
  const phoneDeviceId = store.session!.phoneDeviceId;
  const party = {
    source: { kind: "companion" as const, deviceId: config.desktopDeviceId },
    target: { kind: "phone" as const, deviceId: phoneDeviceId },
    correlationId: inbound.messageId,
  };
  emit(
    createEnvelope({
      ...party,
      type: "job.needs_permission",
      payload: needsPermission,
    }),
  );
  emit(
    createEnvelope({
      ...party,
      type: "permission.request",
      payload: {
        permissionRequestId: needsPermission.permissionRequestId ?? needsPermission.jobId,
        jobId: needsPermission.jobId,
        affairId: needsPermission.affairId,
        requestedPermissions: allowed,
        reason: needsPermission.goal,
        risk: "low",
        proposedScope: needsPermission.workspaceHint ? { workspaceRoot: needsPermission.workspaceHint } : {},
      },
    }),
  );
}

/**
 * 处理 affair.create。
 *
 * @param store 内存 store
 * @param config 配置
 * @param inbound 入站 envelope
 * @param emit 出站回调
 * @returns 处理结果
 */
export function handleAffairCreate(
  store: MemoryStore,
  config: MockCompanionConfig,
  inbound: ProtocolEnvelope,
  emit: EmitEnvelope,
): AffairJobHandleResult {
  const sessionErr = requireSession(store);
  if (sessionErr) {
    return { ok: false, error: sessionErr };
  }
  const payload = inbound.payload as unknown as AffairPayload;
  if (store.affairs.has(payload.affairId)) {
    return {
      ok: false,
      error: createProtocolError("affair_exists", "affairId 已存在", false, {
        affairId: payload.affairId,
      }),
    };
  }
  store.affairs.set(payload.affairId, { ...payload });
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: store.session!.phoneDeviceId },
      type: "affair.update",
      correlationId: inbound.messageId,
      payload: store.affairs.get(payload.affairId)!,
    }),
  );
  return { ok: true };
}

/**
 * 处理 job.create：写入 needs_permission 并出站 permission.request。
 *
 * @param store 内存 store
 * @param config 配置
 * @param inbound 入站 envelope
 * @param emit 出站回调
 * @returns 处理结果
 */
export function handleJobCreate(
  store: MemoryStore,
  config: MockCompanionConfig,
  inbound: ProtocolEnvelope,
  emit: EmitEnvelope,
): AffairJobHandleResult {
  const sessionErr = requireSession(store);
  if (sessionErr) {
    return { ok: false, error: sessionErr };
  }
  const payload = inbound.payload as unknown as JobPayload;
  const allowed = filterKnownPermissions(payload.allowedPermissions ?? []);
  if (allowed.length === 0) {
    return {
      ok: false,
      error: createProtocolError(
        "job_permissions_required",
        "job.create 必须声明至少一个已知 allowedPermissions",
        false,
      ),
    };
  }
  const affair = store.affairs.get(payload.affairId);
  if (!affair) {
    return {
      ok: false,
      error: createProtocolError("affair_not_found", "找不到对应 affair", false, {
        affairId: payload.affairId,
      }),
    };
  }
  if (store.jobs.has(payload.jobId)) {
    return {
      ok: false,
      error: createProtocolError("job_exists", "jobId 已存在（请考虑幂等重试）", false, {
        jobId: payload.jobId,
      }),
    };
  }

  const needsPermission: JobPayload = {
    ...payload,
    status: "needs_permission",
    executor: "openclaw",
    permissionRequestId: payload.permissionRequestId ?? payload.jobId,
    progressSummary: "",
  };
  store.jobs.set(needsPermission.jobId, needsPermission);
  store.permissionItems.push({
    permissionRequestId: needsPermission.permissionRequestId ?? needsPermission.jobId,
    queueStatus: "pending",
    requester: "zhang-boss",
    affairId: needsPermission.affairId,
    jobId: needsPermission.jobId,
    requestedPermissions: allowed,
    reason: needsPermission.goal,
    risk: "low",
    proposedScope: {
      workspaceRoot: needsPermission.workspaceHint ?? null,
      commands: [],
      networkHosts: [],
    },
    availableDecisions: ["allow_once", "allow_for_job", "allow_for_affair", "deny", "require_more_context"],
    denyConsequence: "job 停在 needs_permission",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });

  if (!isExplorationJob(needsPermission)) {
    let nextAffair = { ...affair, currentJobId: needsPermission.jobId };
    if (canTransitionAffairStatus(nextAffair.status, "delegated")) {
      nextAffair = { ...nextAffair, status: "delegated" };
    }
    store.affairs.set(nextAffair.affairId, nextAffair);
  }
  emitJobCreateOutbound(store, config, inbound, needsPermission, allowed, emit);
  return { ok: true };
}
