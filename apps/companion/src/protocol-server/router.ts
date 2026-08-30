/**
 * 电话协议 WS 路由。
 *
 * 职责：校验 envelope，处理 pairing/session/job 门闩，并写入 backend。
 * 不拥有：HTTP 监听、renderer、真实 OpenClaw Gateway。
 * 副作用：更新 backend、identity store，并向 socket 写响应。
 */

import { type WebSocket } from "ws";
import {
  createEnvelope,
  validateMessage,
  type PairingConfirmedPayload,
  type ProtocolEnvelope,
  type SessionOpenPayload,
} from "@lanxin-claw/protocol";
import {
  acceptPairingRequest,
  approveDesktopPairing,
  handlePhoneConfirmed,
} from "../pairing/lifecycle.js";
import type { PairingSession } from "../pairing/session.js";
import { validateInboundAuth, isRequiresSessionType, validateInboundIdentity } from "./guards/inbound/inbound-auth.js";
import { validateInboundFromPhone } from "./guards/inbound/message-direction.js";
import type { ApplyProtocolResult } from "../state/types.js";
import type { CompanionProtocolServerOptions } from "./server.js";
import { handleJobCancel, handleJobCreate } from "./handlers/job-handlers.js";
import { sendJson } from "./router-utils.js";

/**
 * WS 消息处理入参。
 */
export interface HandleProtocolSocketMessageInput {
  /** server 选项 */
  options: CompanionProtocolServerOptions;
  /** 原始文本 */
  text: string;
  /** 出站广播（apply + send） */
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult;
  /** 仅 WS 发送 */
  sendEnvelope: (envelope: ProtocolEnvelope) => void;
  /** socket */
  socket: WebSocket;
  /** 读取 pending pairing */
  getPending: () => PairingSession | null;
  /** 保存 pending pairing */
  setPending: (session: PairingSession) => void;
  /** session.open 成功后标记该 socket 已认证 */
  markSocketAuthenticated?: (socket: WebSocket) => void;
  /** 该 socket 是否已认证 */
  isSocketAuthenticated?: () => boolean;
}

/**
 * 处理 WS 消息。
 *
 * @param input 输入
 */
export async function handleProtocolSocketMessage(
  input: HandleProtocolSocketMessageInput,
): Promise<void> {
  const parsed = parseEnvelope(input.text, input.socket);
  if (!parsed) {
    return;
  }
  const direction = validateInboundFromPhone(parsed);
  if (!direction.ok) {
    sendJson(input.socket, { ok: false, error: direction });
    return;
  }
  const auth = validateInboundAuth(parsed.type, input.isSocketAuthenticated?.() ?? false);
  if (!auth.ok) {
    sendJson(input.socket, { ok: false, error: auth });
    return;
  }
  if (isRequiresSessionType(parsed.type)) {
    const identity = validateInboundIdentity(
      parsed,
      input.options.backend.getState().connection,
      input.options.pairing.desktopDeviceId,
    );
    if (!identity.ok) {
      sendJson(input.socket, { ok: false, error: identity });
      return;
    }
  }
  if (parsed.type === "pairing.request") {
    handlePairingRequest(input, parsed);
    return;
  }
  if (parsed.type === "pairing.confirmed") {
    handlePairingConfirmedMessage(input, parsed);
    return;
  }
  if (parsed.type === "session.open") {
    await handleSessionOpen(input, parsed);
    return;
  }
  if (parsed.type === "job.create") {
    await handleJobCreate(input, parsed);
    return;
  }
  if (parsed.type === "job.cancel") {
    await handleJobCancel(input, parsed);
    return;
  }
  applyToBackend(input.options, parsed, input.socket);
}

/**
 * 批准 pending pairing。
 *
 * @param options 服务选项
 * @param pending 待桌面批准的 pairing
 * @param pairingId 配对 id
 * @param broadcast 广播
 */
export async function approvePendingPairing(
  options: CompanionProtocolServerOptions,
  pending: PairingSession | null,
  pairingId: string,
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult,
): Promise<void> {
  if (!pending || pending.pairingId !== pairingId) {
    throw new Error("pairing_not_found");
  }
  const result = approveDesktopPairing(options.pairing, pending, broadcast);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  const pairingSecret = result.pairingSecret;
  if (!pairingSecret) {
    throw new Error("pairing_secret_missing");
  }
  await options.identityStore.savePairedIdentity({
    pairingId: pending.pairingId,
    phoneDeviceId: pending.phoneDeviceId,
    phoneDisplayName: pending.phoneDisplayName,
    desktopDeviceId: pending.desktopDeviceId,
    desktopDisplayName: pending.desktopDisplayName,
    pairingSecret,
    pairedAt: pending.pairedAt ?? new Date().toISOString(),
  });
}

/**
 * 解析并校验 envelope。
 */
function parseEnvelope(text: string, socket: WebSocket): ProtocolEnvelope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    sendJson(socket, { ok: false, error: { code: "invalid_json", message: "WS 帧不是合法 JSON", retryable: false } });
    return null;
  }
  const validated = validateMessage(raw);
  if (!validated.ok) {
    sendJson(socket, { ok: false, error: validated.error });
    return null;
  }
  return validated.value as ProtocolEnvelope;
}

/**
 * 处理 pairing.request。
 */
function handlePairingRequest(
  input: HandleProtocolSocketMessageInput,
  envelope: ProtocolEnvelope,
): void {
  const result = input.options.backend.applyProtocolEnvelope(envelope);
  if (!result.ok) {
    sendJson(input.socket, { ok: false, error: result });
    return;
  }
  const lifecycle = acceptPairingRequest(input.options.pairing, envelope, input.broadcast);
  if (!lifecycle.ok) {
    sendJson(input.socket, { ok: false, error: lifecycle.error });
    return;
  }
  input.setPending(lifecycle.session);
}

/**
 * 处理 pairing.confirmed。
 */
function handlePairingConfirmedMessage(
  input: HandleProtocolSocketMessageInput,
  envelope: ProtocolEnvelope,
): void {
  const payload = envelope.payload as unknown as PairingConfirmedPayload;
  const pending = input.getPending();
  if (!pending || pending.pairingId !== payload.pairingId) {
    sendJson(input.socket, {
      ok: false,
      error: { code: "pairing_not_found", message: "找不到 pending pairing", retryable: false },
    });
    return;
  }
  const result = handlePhoneConfirmed(input.options.pairing, pending, envelope);
  if (!result.ok) {
    sendJson(input.socket, { ok: false, error: result.error });
    return;
  }
  input.options.backend.applyProtocolEnvelope(envelope);
  sendJson(input.socket, { ok: true, acceptedType: "pairing.confirmed" });
}

/**
 * 处理 session.open。
 */
async function handleSessionOpen(
  input: HandleProtocolSocketMessageInput,
  envelope: ProtocolEnvelope,
): Promise<void> {
  const payload = envelope.payload as unknown as SessionOpenPayload;
  const auth = await input.options.identityStore.authenticateReconnect(payload);
  if (!auth.ok) {
    broadcastReauthRequired(payload, envelope.messageId, auth, input.broadcast);
    sendJson(input.socket, { ok: false, error: { code: "session_reauth_required", message: auth.reason, retryable: false } });
    return;
  }
  input.options.backend.applyProtocolEnvelope(envelope);
  input.markSocketAuthenticated?.(input.socket);
  input.broadcast(createEnvelope({
    source: { kind: "companion", deviceId: payload.desktopDeviceId },
    target: { kind: "phone", deviceId: payload.phoneDeviceId },
    type: "session.accepted",
    correlationId: envelope.messageId,
    payload: {
      sessionId: payload.sessionId,
      acceptedAt: new Date().toISOString(),
      heartbeatIntervalMs: 5000,
    },
  }));
  input.options.onSessionAccepted?.();
}

/**
 * 广播重认证要求。
 */
function broadcastReauthRequired(
  payload: SessionOpenPayload,
  correlationId: string,
  auth: { reason: string; requiredAction: "reopen" | "repair" },
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult,
): void {
  broadcast(createEnvelope({
    source: { kind: "companion", deviceId: payload.desktopDeviceId },
    target: { kind: "phone", deviceId: payload.phoneDeviceId },
    type: "session.reauth_required",
    correlationId,
    payload: {
      sessionId: payload.sessionId,
      reason: auth.reason,
      requiredAction: auth.requiredAction,
    },
  }));
}

/**
 * 应用到 backend。
 */
function applyToBackend(
  options: CompanionProtocolServerOptions,
  envelope: ProtocolEnvelope,
  socket: WebSocket,
): void {
  let normalized = envelope;
  if (envelope.type === "chat.message" && envelope.source.kind === "phone") {
    const payload = envelope.payload as { authorKind?: unknown };
    const authorKind = payload.authorKind === "zhang-boss" ? "zhang-boss" : "user";
    normalized = {
      ...envelope,
      payload: { ...envelope.payload as object, authorKind },
    } as ProtocolEnvelope;
  }
  const applied = options.backend.applyProtocolEnvelope(normalized);
  if (!applied.ok) {
    sendJson(socket, { ok: false, error: applied });
    return;
  }
  sendJson(socket, {
    ok: true,
    acceptedType: envelope.type,
    ...(applied.duplicate ? { duplicate: true } : {}),
  });
}

/**
 * 发送 JSON。
 */
export { sendJson } from "./router-utils.js";
