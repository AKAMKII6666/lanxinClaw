/**
 * 内存配对与会话 mock。
 *
 * 职责：处理 pairing.* / session.*，自动桌面确认并写入 store。
 * 不拥有：真实双确认 UI、OS 安全存储、公网 relay。
 * 副作用：更新 store；通过 emit 回推协议消息。
 */

import {
  createEnvelope,
  createProtocolError,
  type PairingChallengePayload,
  type PairingCompletedPayload,
  type PairingConfirmedPayload,
  type PairingDesktopApprovedPayload,
  type PairingRequestPayload,
  type ProtocolEnvelope,
  type ProtocolError,
  type SessionAcceptedPayload,
  type SessionOpenPayload,
} from "@lanxin-claw/protocol";
import type { MockCompanionConfig } from "../config.js";
import type { MemoryStore } from "../store/memory-store.js";

/**
 * 出站消息回调。
 */
export type EmitEnvelope = (envelope: ProtocolEnvelope<any>) => void;

/**
 * 处理结果：错误或空（成功已 emit）。
 */
export type HandleResult = { ok: true } | { ok: false; error: ProtocolError };

/**
 * 处理 pairing.request：发出 challenge。
 *
 * @param store 内存 store
 * @param config 配置
 * @param inbound 入站 envelope
 * @param emit 出站回调
 * @returns 处理结果
 */
export function handlePairingRequest(
  store: MemoryStore,
  config: MockCompanionConfig,
  inbound: ProtocolEnvelope,
  emit: EmitEnvelope,
): HandleResult {
  const payload = inbound.payload as unknown as PairingRequestPayload;
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const challenge = `mock-challenge-${payload.pairingId}`;
  store.pendingChallenge = {
    pairingId: payload.pairingId,
    challenge,
    expiresAt,
    phoneDeviceId: payload.phoneDeviceId,
    phoneDisplayName: payload.phoneDisplayName,
  };
  const outPayload: PairingChallengePayload = {
    pairingId: payload.pairingId,
    desktopDeviceId: config.desktopDeviceId,
    desktopDisplayName: config.desktopDisplayName,
    challenge,
    expiresAt,
  };
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: payload.phoneDeviceId },
      type: "pairing.challenge",
      correlationId: inbound.messageId,
      payload: outPayload,
    }),
  );
  return { ok: true };
}

/**
 * 处理 pairing.confirmed：校验 challenge 应答与过期后，自动 desktop_approved + completed。
 *
 * @param store 内存 store
 * @param config 配置
 * @param inbound 入站 envelope
 * @param emit 出站回调
 * @returns 处理结果；应答错误或过期时不写入 paired、不发 completed
 */
export function handlePairingConfirmed(
  store: MemoryStore,
  config: MockCompanionConfig,
  inbound: ProtocolEnvelope,
  emit: EmitEnvelope,
): HandleResult {
  const payload = inbound.payload as unknown as PairingConfirmedPayload;
  const pending = store.pendingChallenge;
  if (!pending || pending.pairingId !== payload.pairingId) {
    return {
      ok: false,
      error: createProtocolError("pairing_challenge_missing", "没有匹配的 pairing challenge", false),
    };
  }
  const expiresAtMs = Date.parse(pending.expiresAt);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    store.pendingChallenge = null;
    return {
      ok: false,
      error: createProtocolError(
        "pairing_challenge_expired",
        "pairing challenge 已过期，须重新 pairing.request",
        false,
      ),
    };
  }
  if (payload.challengeResponse !== pending.challenge) {
    store.pendingChallenge = null;
    return {
      ok: false,
      error: createProtocolError(
        "pairing_challenge_mismatch",
        "challengeResponse 与 pending challenge 不一致，配对失败",
        false,
      ),
    };
  }
  const phoneDeviceId = pending.phoneDeviceId;
  const phoneDisplayName = pending.phoneDisplayName;
  const pairedAt = new Date().toISOString();
  const authProof = `mock-paired:${payload.pairingId}`;
  store.paired = {
    pairingId: payload.pairingId,
    phoneDeviceId,
    phoneDisplayName,
    authProof,
    pairedAt,
  };
  store.pendingChallenge = null;

  const approved: PairingDesktopApprovedPayload = {
    pairingId: payload.pairingId,
    desktopApprovedAt: pairedAt,
  };
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: phoneDeviceId },
      type: "pairing.desktop_approved",
      correlationId: inbound.messageId,
      payload: approved,
    }),
  );

  const completed: PairingCompletedPayload = {
    pairingId: payload.pairingId,
    phoneDeviceId,
    desktopDeviceId: config.desktopDeviceId,
    pairedAt,
  };
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: phoneDeviceId },
      type: "pairing.completed",
      correlationId: inbound.messageId,
      payload: completed,
    }),
  );
  return { ok: true };
}

/**
 * 处理 session.open：校验 mock authProof 后接受会话。
 *
 * @param store 内存 store
 * @param config 配置
 * @param inbound 入站 envelope
 * @param emit 出站回调
 * @returns 处理结果
 */
export function handleSessionOpen(
  store: MemoryStore,
  config: MockCompanionConfig,
  inbound: ProtocolEnvelope,
  emit: EmitEnvelope,
): HandleResult {
  const payload = inbound.payload as unknown as SessionOpenPayload;
  if (!store.paired) {
    return {
      ok: false,
      error: createProtocolError("not_paired", "尚未完成配对", false),
    };
  }
  if (payload.authProof !== store.paired.authProof) {
    return {
      ok: false,
      error: createProtocolError("auth_failed", "authProof 与配对身份不匹配", false),
    };
  }
  if (payload.desktopDeviceId !== config.desktopDeviceId) {
    return {
      ok: false,
      error: createProtocolError("device_mismatch", "desktopDeviceId 不匹配", false),
    };
  }
  const openedAt = new Date().toISOString();
  store.session = {
    sessionId: payload.sessionId,
    phoneDeviceId: payload.phoneDeviceId,
    openedAt,
  };
  const accepted: SessionAcceptedPayload = {
    sessionId: payload.sessionId,
    acceptedAt: openedAt,
    heartbeatIntervalMs: 30_000,
  };
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: payload.phoneDeviceId },
      type: "session.accepted",
      correlationId: inbound.messageId,
      payload: accepted,
    }),
  );
  return { ok: true };
}
