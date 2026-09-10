/**
 * 真实 companion 的 pairing 生命周期（双确认）。
 *
 * 职责：驱动 request → challenge → confirmed → desktop_approved → completed / revoked。
 * 不拥有：identity 持久化、LAN discovery、OpenClaw、权限授予。
 * 副作用：更新内存会话；经 emit 回推协议 envelope；桌面批准必须显式调用。
 */

import {
canTransitionPairingStatus,
createEnvelope,
createProtocolError,
type PairingChallengePayload,
type PairingCompletedPayload,
type PairingConfirmedPayload,
type PairingDesktopApprovedPayload,
type PairingRequestPayload,
type PairingRevokedPayload,
type PairingStatus,
type ProtocolEnvelope,
type ProtocolError,
} from "@lanxin-claw/protocol";
import { createPairingSecret } from "../credentials/auth-proof.js";
import { createPairingChallenge, verifyChallengeResponse } from "./challenge.js";
import { createEmptyPairingSession, type PairingSession } from "./session.js";

/**
 * 受理 pairing.request：进入 pairing_requested 并发出 challenge。
 *
 * @param deps 依赖
 * @param inbound 入站 envelope
 * @param emit 出站回调
 * @returns 新会话或错误
 */
export function acceptPairingRequest(
  deps: PairingLifecycleDeps,
  inbound: ProtocolEnvelope,
  emit: EmitPairingEnvelope,
): { ok: true; session: PairingSession } | { ok: false; error: ProtocolError } {
  const payload = inbound.payload as unknown as PairingRequestPayload;
  const now = deps.now ?? Date.now;
  const ttl = deps.challengeTtlMs ?? 5 * 60_000;
  const session = createEmptyPairingSession({
    pairingId: payload.pairingId,
    phoneDeviceId: payload.phoneDeviceId,
    phoneDisplayName: payload.phoneDisplayName,
    desktopDeviceId: deps.desktopDeviceId,
    desktopDisplayName: deps.desktopDisplayName,
    capabilities: payload.capabilities,
  });
  const moved = transition(session, "pairing_requested");
  if (!moved.ok) {
    return moved;
  }
  const challenge = createPairingChallenge();
  const expiresAt = new Date(now() + ttl).toISOString();
  session.challenge = challenge;
  session.expiresAt = expiresAt;

  const out: PairingChallengePayload = {
    pairingId: payload.pairingId,
    desktopDeviceId: deps.desktopDeviceId,
    desktopDisplayName: deps.desktopDisplayName,
    challenge,
    expiresAt,
  };
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: deps.desktopDeviceId },
      target: { kind: "phone", deviceId: payload.phoneDeviceId },
      type: "pairing.challenge",
      correlationId: inbound.messageId,
      payload: out,
    }),
  );
  return { ok: true, session };
}

/**
 * 处理 pairing.confirmed：校验 challenge 后进入 phone_confirmed。
 *
 * @param deps 依赖
 * @param session 当前会话
 * @param inbound 入站
 * @returns 结果；失败时可能把状态迁到 pairing_rejected
 */
export function handlePhoneConfirmed(
  deps: PairingLifecycleDeps,
  session: PairingSession,
  inbound: ProtocolEnvelope,
): PairingHandleResult {
  const payload = inbound.payload as unknown as PairingConfirmedPayload;
  if (payload.pairingId !== session.pairingId) {
    return {
      ok: false,
      error: createProtocolError("pairing_id_mismatch", "pairingId 与当前会话不一致", false),
    };
  }
  if (session.status !== "pairing_requested" || !session.challenge || !session.expiresAt) {
    return {
      ok: false,
      error: createProtocolError("pairing_challenge_missing", "没有匹配的 pairing challenge", false),
    };
  }
  const now = deps.now ?? Date.now;
  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs) || now() > expiresAtMs) {
    session.challenge = null;
    session.expiresAt = null;
    transition(session, "pairing_rejected");
    return {
      ok: false,
      error: createProtocolError(
        "pairing_challenge_expired",
        "pairing challenge 已过期，须重新 pairing.request",
        false,
      ),
    };
  }
  if (!verifyChallengeResponse(session.challenge, payload.challengeResponse)) {
    session.challenge = null;
    session.expiresAt = null;
    transition(session, "pairing_rejected");
    return {
      ok: false,
      error: createProtocolError(
        "pairing_challenge_mismatch",
        "challengeResponse 与 pending challenge 不一致，配对失败",
        false,
      ),
    };
  }
  const moved = transition(session, "phone_confirmed");
  if (!moved.ok) {
    return moved;
  }
  session.phoneConfirmedAt = payload.phoneConfirmedAt;
  return { ok: true };
}

/**
 * 桌面用户批准：发出 desktop_approved 与 completed，进入 paired。
 *
 * @param deps 依赖
 * @param session 会话（须已 phone_confirmed）
 * @param emit 出站
 * @param correlationId 可选关联 id
 * @param pairingSecret 可选注入共享秘密；缺省时生成新秘密
 * @returns 结果
 */
export function approveDesktopPairing(
  deps: PairingLifecycleDeps,
  session: PairingSession,
  emit: EmitPairingEnvelope,
  correlationId?: string,
  pairingSecret?: string,
): PairingHandleResult {
  if (session.status !== "phone_confirmed") {
    return {
      ok: false,
      error: createProtocolError(
        "pairing_desktop_premature",
        "桌面批准前须已完成电话侧 challenge 确认",
        false,
        { status: session.status },
      ),
    };
  }
  const now = deps.now ?? Date.now;
  const approvedAt = new Date(now()).toISOString();
  const toDesktop = transition(session, "desktop_confirmed");
  if (!toDesktop.ok) {
    return toDesktop;
  }
  session.desktopApprovedAt = approvedAt;

  const approved: PairingDesktopApprovedPayload = {
    pairingId: session.pairingId,
    desktopApprovedAt: approvedAt,
  };
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: deps.desktopDeviceId },
      target: { kind: "phone", deviceId: session.phoneDeviceId },
      type: "pairing.desktop_approved",
      ...optionalCorrelation(correlationId),
      payload: approved,
    }),
  );

  const toPaired = transition(session, "paired");
  if (!toPaired.ok) {
    return toPaired;
  }
  session.pairedAt = approvedAt;
  session.challenge = null;
  session.expiresAt = null;
  const secret = pairingSecret ?? createPairingSecret();

  const completed: PairingCompletedPayload = {
    pairingId: session.pairingId,
    phoneDeviceId: session.phoneDeviceId,
    desktopDeviceId: deps.desktopDeviceId,
    pairingSecret: secret,
    pairedAt: approvedAt,
  };
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: deps.desktopDeviceId },
      target: { kind: "phone", deviceId: session.phoneDeviceId },
      type: "pairing.completed",
      ...optionalCorrelation(correlationId),
      payload: completed,
    }),
  );
  return { ok: true, pairingSecret: secret };
}

/**
 * 解析拒绝/撤销的目标状态。
 *
 * @param status 当前状态
 * @returns 目标终态；不可迁时为 null
 */
function rejectTargetStatus(status: PairingStatus): PairingStatus | null {
  if (status === "paired") {
    return "revoked";
  }
  if (canTransitionPairingStatus(status, "pairing_rejected")) {
    return "pairing_rejected";
  }
  if (canTransitionPairingStatus(status, "revoked")) {
    return "revoked";
  }
  return null;
}

/**
 * 桌面拒绝或任一方撤销：发出 pairing.revoked。
 *
 * @param deps 依赖
 * @param session 会话
 * @param reason 原因
 * @param emit 出站
 * @param correlationId 可选关联
 * @returns 结果
 */
export function revokeOrRejectPairing(
  deps: PairingLifecycleDeps,
  session: PairingSession,
  reason: string,
  emit: EmitPairingEnvelope,
  correlationId?: string,
): PairingHandleResult {
  const target = rejectTargetStatus(session.status);
  if (target === null) {
    return {
      ok: false,
      error: createProtocolError(
        "pairing_already_terminal",
        `pairing 已处于终态 ${session.status}，无法再拒绝或撤销`,
        false,
      ),
    };
  }
  const moved = transition(session, target);
  if (!moved.ok) {
    return moved;
  }
  const now = deps.now ?? Date.now;
  const revokedAt = new Date(now()).toISOString();
  const payload: PairingRevokedPayload = {
    pairingId: session.pairingId,
    phoneDeviceId: session.phoneDeviceId,
    desktopDeviceId: deps.desktopDeviceId,
    reason,
    revokedAt,
  };
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: deps.desktopDeviceId },
      target: { kind: "phone", deviceId: session.phoneDeviceId },
      type: "pairing.revoked",
      ...optionalCorrelation(correlationId),
      payload,
    }),
  );
  session.challenge = null;
  session.expiresAt = null;
  return { ok: true };
}

import type { EmitPairingEnvelope, PairingHandleResult, PairingLifecycleDeps } from "./lifecycle/types.js";
export type { EmitPairingEnvelope, PairingHandleErr, PairingHandleOk, PairingHandleResult, PairingLifecycleDeps } from "./lifecycle/types.js";

import { optionalCorrelation, transition } from "./lifecycle/transition.js";
