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
  type JobPayload,
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
import { enqueueJobPermission } from "./job-permission.js";
import type { CompanionProtocolServerOptions } from "./server.js";

/**
 * WS 消息处理入参。
 */
export interface HandleProtocolSocketMessageInput {
  /** server 选项 */
  options: CompanionProtocolServerOptions;
  /** 原始文本 */
  text: string;
  /** 出站广播 */
  broadcast: (envelope: ProtocolEnvelope) => void;
  /** socket */
  socket: WebSocket;
  /** 读取 pending pairing */
  getPending: () => PairingSession | null;
  /** 保存 pending pairing */
  setPending: (session: PairingSession) => void;
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
  if (parsed.type === "pairing.request") {
    handlePairingRequest(input, parsed);
    return;
  }
  if (parsed.type === "pairing.confirmed") {
    handlePairingConfirmedMessage(input, parsed);
    return;
  }
  if (parsed.type === "session.open") {
    await handleSessionOpen(input.options, parsed, input.broadcast, input.socket);
    return;
  }
  if (parsed.type === "job.create") {
    const queued = enqueueJobPermission(input.options, parsed);
    if (!queued.ok) {
      sendJson(input.socket, { ok: false, error: queued });
      return;
    }
    applyToBackend(
      input.options,
      {
        ...parsed,
        type: "job.needs_permission",
        payload: { ...(parsed.payload as unknown as JobPayload), status: "needs_permission" },
      },
      input.socket,
    );
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
  broadcast: (envelope: ProtocolEnvelope) => void,
): Promise<void> {
  if (!pending || pending.pairingId !== pairingId) {
    throw new Error("pairing_not_found");
  }
  const result = approveDesktopPairing(options.pairing, pending, broadcast);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  await options.identityStore.savePairedIdentity({
    pairingId: pending.pairingId,
    phoneDeviceId: pending.phoneDeviceId,
    phoneDisplayName: pending.phoneDisplayName,
    desktopDeviceId: pending.desktopDeviceId,
    desktopDisplayName: pending.desktopDisplayName,
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
  options: CompanionProtocolServerOptions,
  envelope: ProtocolEnvelope,
  broadcast: (envelope: ProtocolEnvelope) => void,
  socket: WebSocket,
): Promise<void> {
  const payload = envelope.payload as unknown as SessionOpenPayload;
  const auth = await options.identityStore.authenticateReconnect(payload);
  if (!auth.ok) {
    broadcastReauthRequired(payload, envelope.messageId, auth, broadcast);
    sendJson(socket, { ok: false, error: { code: "session_reauth_required", message: auth.reason, retryable: false } });
    return;
  }
  options.backend.applyProtocolEnvelope(envelope);
  broadcast(createEnvelope({
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
}

/**
 * 广播重认证要求。
 */
function broadcastReauthRequired(
  payload: SessionOpenPayload,
  correlationId: string,
  auth: { reason: string; requiredAction: "reopen" | "repair" },
  broadcast: (envelope: ProtocolEnvelope) => void,
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
  const applied = options.backend.applyProtocolEnvelope(envelope);
  if (!applied.ok) {
    sendJson(socket, { ok: false, error: applied });
  }
}

/**
 * 发送 JSON。
 */
function sendJson(socket: WebSocket, body: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(body));
  }
}
