/**
 * 电话协议 WS 路由。
 *
 * 职责：校验 envelope，处理 pairing/session/job 门闩，并写入 backend。
 * 不拥有：HTTP 监听、renderer、真实 OpenClaw Gateway。
 * 副作用：更新 backend、identity store，并向 socket 写响应。
 */

import {
createEnvelope,
validateMessage,
type PairingConfirmedPayload,
type ProtocolEnvelope,
type SessionOpenPayload,
} from "@lanxin-claw/protocol";
import { type WebSocket } from "ws";
import {
acceptPairingRequest,
approveDesktopPairing,
handlePhoneConfirmed,
} from "../pairing/lifecycle.js";
import type { PairingSession } from "../pairing/session.js";
import type { ApplyProtocolResult } from "../state/types.js";
import { isRequiresSessionType, validateInboundAuth, validateInboundIdentity } from "./guards/inbound/inbound-auth.js";
import { validateInboundFromPhone } from "./guards/inbound/message-direction.js";
import { handleAffairClose } from "./handlers/affair-handlers.js";
import { handleJobCancel, handleJobCreate } from "./handlers/job-handlers.js";
import { replyRequest, sendRequestResult } from "./request-reply.js";
import type { CompanionProtocolServerOptions } from "./server.js";

/**
 * WS 消息处理入参。
 */
export interface HandleProtocolSocketMessageInput {
  /** 当前已解析请求；由路由绑定，供并发回执精确关联 */
  request?: ProtocolEnvelope;
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
  input = { ...input, request: parsed };
  if (!checkInboundGuards(input, parsed)) return;
  await dispatchAuthenticatedMessage(input, parsed);
}

function checkInboundGuards(input: HandleProtocolSocketMessageInput, parsed: ProtocolEnvelope): boolean {
  const direction = validateInboundFromPhone(parsed);
  if (!direction.ok) {
    replyRequest(input, { ok: false, error: direction });
    return false;
  }
  const auth = validateInboundAuth(parsed.type, input.isSocketAuthenticated?.() ?? false);
  if (!auth.ok) {
    replyRequest(input, { ok: false, error: auth });
    return false;
  }
  if (isRequiresSessionType(parsed.type)) {
    const identity = validateInboundIdentity(
      parsed,
      input.options.backend.getState().connection,
      input.options.pairing.desktopDeviceId,
    );
    if (!identity.ok) {
      replyRequest(input, { ok: false, error: identity });
      return false;
    }
  }
  return true;
}

async function dispatchAuthenticatedMessage(input: HandleProtocolSocketMessageInput, parsed: ProtocolEnvelope): Promise<void> {
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
  if (parsed.type === "affair.close") {
    await handleAffairClose(input, parsed);
    return;
  }
  const affairId = (parsed.payload as { affairId?: string }).affairId;
  const operations = input.options.backend.getAffairActions().operations;
  if (parsed.type === "job.create") {
    await operations.run(affairId ?? "", () => handleJobCreate(input, parsed));
    return;
  }
  if (parsed.type === "job.cancel") {
    await operations.run(affairId ?? "", () => handleJobCancel(input, parsed));
    return;
  }
  if (affairId && parsed.type.startsWith("affair.")) {
    await operations.run(affairId, async () => applyToBackend(input.options, parsed, input.socket));
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
    sendRequestResult(socket, null, { ok: false, error: { code: "invalid_json", message: "WS 帧不是合法 JSON", retryable: false } });
    return null;
  }
  const validated = validateMessage(raw);
  if (!validated.ok) {
    sendRequestResult(socket, raw, { ok: false, error: validated.error });
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
    replyRequest(input, { ok: false, error: result });
    return;
  }
  const lifecycle = acceptPairingRequest(input.options.pairing, envelope, input.broadcast);
  if (!lifecycle.ok) {
    replyRequest(input, { ok: false, error: lifecycle.error });
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
    replyRequest(input, {
      ok: false,
      error: { code: "pairing_not_found", message: "找不到 pending pairing", retryable: false },
    });
    return;
  }
  const result = handlePhoneConfirmed(input.options.pairing, pending, envelope);
  if (!result.ok) {
    replyRequest(input, { ok: false, error: result.error });
    return;
  }
  input.options.backend.applyProtocolEnvelope(envelope);
  replyRequest(input, { ok: true, acceptedType: "pairing.confirmed" });
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
    replyRequest(input, { ok: false, error: { code: "session_reauth_required", message: auth.reason, retryable: false } });
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
 * 发送 JSON。
 */
export { sendJson } from "./router-utils.js";

import { applyToBackend } from "./handlers/state-handlers.js";
