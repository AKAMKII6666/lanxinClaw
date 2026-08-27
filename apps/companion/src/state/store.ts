/**
 * Companion backend store。
 *
 * 职责：消费已校验协议 envelope，维护真实运行态并保证状态机门闩。
 * 不拥有：WebSocket 传输、renderer 渲染、OpenClaw 执行。
 * 副作用：仅修改内存状态。
 */

import {
  canTransitionAffairStatus,
  canTransitionJobStatus,
  validateMessage,
  type AffairPayload,
  type ChatContextAttachPayload,
  type ChatMessagePayload,
  type ChatReadReceiptPayload,
  type JobPayload,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import type { ApplyProtocolResult, CompanionBackendState } from "./types.js";

/**
 * 创建空 backend state。
 *
 * @param startedAtMs 启动时间
 * @returns state
 */
export function createCompanionBackendState(startedAtMs = Date.now()): CompanionBackendState {
  const now = new Date(startedAtMs).toISOString();
  return {
    startedAtMs,
    updatedAt: now,
    connection: {
      phoneDeviceId: null,
      phoneDisplayName: null,
      pairingId: null,
      sessionId: null,
      lastSeenAt: null,
      sessionAuthenticated: false,
    },
    affairs: new Map(),
    jobs: new Map(),
    chatMessages: [],
    contextAttachments: [],
    chatReceipts: [],
    auditRecords: [],
    lastError: null,
    seenMessages: new Map(),
  };
}

/**
 * 应用协议 envelope。
 *
 * @param state backend state
 * @param envelope 入站 envelope
 * @param now 时间
 * @returns 处理结果
 */
export function applyProtocolEnvelopeToState(
  state: CompanionBackendState,
  envelope: ProtocolEnvelope,
  now = new Date().toISOString(),
): ApplyProtocolResult {
  const validated = validateMessage(envelope);
  if (!validated.ok) {
    return fail("protocol_invalid", validated.error.message, false, state, now);
  }
  if (state.seenMessages.has(envelope.messageId)) {
    return { ok: true, duplicate: true, envelope };
  }
  const result = applyValidatedEnvelope(state, envelope, now);
  if (result.ok) {
    state.seenMessages.set(envelope.messageId, { messageId: envelope.messageId, seenAt: now });
    state.updatedAt = now;
  }
  return result;
}

/**
 * 分发已校验 envelope。
 *
 * @param state state
 * @param envelope envelope
 * @param now 时间
 * @returns 结果
 */
function applyValidatedEnvelope(
  state: CompanionBackendState,
  envelope: ProtocolEnvelope,
  now: string,
): ApplyProtocolResult {
  if (envelope.type === "pairing.request") {
    const payload = envelope.payload as unknown as {
      pairingId: string;
      phoneDeviceId: string;
      phoneDisplayName: string;
    };
    state.connection.pairingId = payload.pairingId;
    state.connection.phoneDeviceId = payload.phoneDeviceId;
    state.connection.phoneDisplayName = payload.phoneDisplayName;
    state.connection.lastSeenAt = now;
    return { ok: true, envelope };
  }
  if (envelope.type === "session.open") {
    const payload = envelope.payload as { sessionId: string; phoneDeviceId: string };
    state.connection.sessionId = payload.sessionId;
    state.connection.phoneDeviceId = payload.phoneDeviceId;
    state.connection.sessionAuthenticated = true;
    state.connection.lastSeenAt = now;
    return { ok: true, envelope };
  }
  if (envelope.type === "session.heartbeat") {
    state.connection.lastSeenAt = now;
    return { ok: true, envelope };
  }
  if (envelope.type === "session.closed") {
    state.connection.sessionAuthenticated = false;
    state.connection.lastSeenAt = now;
    return { ok: true, envelope };
  }
  if (envelope.type.startsWith("affair.")) {
    return applyAffair(state, envelope, now);
  }
  if (envelope.type.startsWith("job.")) {
    return applyJob(state, envelope, now);
  }
  if (envelope.type === "chat.message") {
    state.chatMessages.push(envelope.payload as unknown as ChatMessagePayload);
    return { ok: true, envelope };
  }
  if (envelope.type === "chat.context_attach") {
    state.contextAttachments.push(envelope.payload as unknown as ChatContextAttachPayload);
    return { ok: true, envelope };
  }
  if (envelope.type === "chat.read_receipt") {
    state.chatReceipts.push(envelope.payload as unknown as ChatReadReceiptPayload);
    return { ok: true, envelope };
  }
  return { ok: true, envelope };
}

/**
 * 应用 affair 事件。
 *
 * @param state state
 * @param envelope envelope
 * @param now 时间
 * @returns 结果
 */
function applyAffair(
  state: CompanionBackendState,
  envelope: ProtocolEnvelope,
  now: string,
): ApplyProtocolResult {
  const payload = envelope.payload as unknown as AffairPayload;
  const existing = state.affairs.get(payload.affairId);
  if (existing && !canTransitionAffairStatus(existing.status, payload.status)) {
    return fail(
      "affair_illegal_transition",
      `affair 状态不可从 ${existing.status} 迁到 ${payload.status}`,
      false,
      state,
      now,
    );
  }
  state.affairs.set(payload.affairId, cloneAffair(payload));
  return { ok: true, envelope };
}

/**
 * 应用 job 事件。
 *
 * @param state state
 * @param envelope envelope
 * @param now 时间
 * @returns 结果
 */
function applyJob(
  state: CompanionBackendState,
  envelope: ProtocolEnvelope,
  now: string,
): ApplyProtocolResult {
  if (envelope.type === "job.cancel") {
    return applyJobCancel(state, envelope, now);
  }
  const payload = envelope.payload as unknown as JobPayload;
  const existing = state.jobs.get(payload.jobId);
  if (existing && !canTransitionJobStatus(existing.status, payload.status)) {
    return fail(
      "job_illegal_transition",
      `job 状态不可从 ${existing.status} 迁到 ${payload.status}`,
      false,
      state,
      now,
    );
  }
  state.jobs.set(payload.jobId, cloneJob(payload));
  const affair = state.affairs.get(payload.affairId);
  if (affair) {
    updateAffairFromJob(state, affair, payload);
  }
  return { ok: true, envelope };
}

/**
 * 应用 job.cancel 事件。
 *
 * @param state state
 * @param envelope envelope
 * @param now 时间
 * @returns 结果
 */
function applyJobCancel(
  state: CompanionBackendState,
  envelope: ProtocolEnvelope,
  now: string,
): ApplyProtocolResult {
  const payload = envelope.payload as unknown as { jobId: string; affairId: string };
  const existing = state.jobs.get(payload.jobId);
  if (!existing) {
    return fail("job_not_found", `找不到 jobId=${payload.jobId}`, false, state, now);
  }
  if (!canTransitionJobStatus(existing.status, "canceled")) {
    return fail(
      "job_illegal_transition",
      `job 状态不可从 ${existing.status} 迁到 canceled`,
      false,
      state,
      now,
    );
  }
  const canceled: JobPayload = {
    ...existing,
    status: "canceled",
    progressSummary: existing.progressSummary || "canceled_by_phone",
  };
  state.jobs.set(payload.jobId, canceled);
  const affair = state.affairs.get(payload.affairId);
  if (affair) {
    updateAffairFromJob(state, affair, canceled);
  }
  return { ok: true, envelope };
}

/**
 * 根据 job 安全投影 affair。
 *
 * @param state state
 * @param affair affair
 * @param job job
 */
function updateAffairFromJob(
  state: CompanionBackendState,
  affair: AffairPayload,
  job: JobPayload,
): void {
  const nextStatus = job.status === "completed" ? "waiting_acceptance" : job.status === "blocked" ? "blocked" : null;
  if (!nextStatus || !canTransitionAffairStatus(affair.status, nextStatus)) {
    return;
  }
  state.affairs.set(affair.affairId, {
    ...affair,
    status: nextStatus,
    currentJobId: job.jobId,
    blockedReason: job.blockedReason ?? null,
    resumeCondition: job.resumeCondition ?? null,
  });
}

/**
 * 记录失败。
 *
 * @param code 错误码
 * @param message 消息
 * @param retryable 是否可重试
 * @param state state
 * @param now 时间
 * @returns 失败
 */
function fail(
  code: string,
  message: string,
  retryable: boolean,
  state: CompanionBackendState,
  now: string,
): ApplyProtocolResult {
  state.lastError = { code, message, occurredAt: now, affairId: null, jobId: null };
  return { ok: false, code, message, retryable };
}

/**
 * @param payload affair
 * @returns 副本
 */
function cloneAffair(payload: AffairPayload): AffairPayload {
  return {
    ...payload,
    context: [...payload.context],
    acceptanceCriteria: [...payload.acceptanceCriteria],
  };
}

/**
 * @param payload job
 * @returns 副本
 */
function cloneJob(payload: JobPayload): JobPayload {
  return {
    ...payload,
    allowedPermissions: [...payload.allowedPermissions],
  };
}
