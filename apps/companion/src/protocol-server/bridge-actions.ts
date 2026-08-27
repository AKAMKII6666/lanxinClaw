/**
 * 将控制面板 UI 意图转为协议出站。
 *
 * 职责：chat / context_attach / affair.resume / permission.decision。
 * 不拥有：gate 裁决本身、OpenClaw、renderer。
 * 副作用：broadcast 或入 pending 队列。
 */

import {
  canTransitionAffairStatus,
  type AffairPayload,
  type PermissionDecisionPayload,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import type { BridgeUiAction } from "../bridge/contract.js";
import {
  buildContextAttach,
  buildUserChatMessage,
} from "../chat/build-outbound.js";
import type { PendingContextQueue } from "../chat/channel/pending-context.js";
import {
  buildAffairResumeEnvelope,
  buildChatMessageEnvelope,
  buildContextAttachEnvelope,
  buildPermissionDecisionEnvelope,
  type OutboundParty,
} from "./outbound-envelopes.js";

/**
 * 出站依赖。
 */
export interface BridgeProtocolOutboundDeps {
  /** 寻址；无电话时仍 apply 本地 */
  getParty: () => OutboundParty | null;
  /** 是否已认证 session */
  isSessionAuthenticated: () => boolean;
  /** 是否有活跃通话（本仓无通话真源时恒 false） */
  hasActiveCall: () => boolean;
  /** 读 affair */
  getAffair: (affairId: string) => AffairPayload | undefined;
  /** 广播 */
  broadcast: (envelope: ProtocolEnvelope) => void;
  /** pending 队列 */
  pendingContext: PendingContextQueue;
}

/**
 * 处理需要出站的 bridge action。
 *
 * @param action UI 动作
 * @param deps 依赖
 * @param permissionDecision 可选已裁决的 permission.decision 载荷
 * @returns 错误信息；成功为 null
 */
export function dispatchBridgeProtocolAction(
  action: BridgeUiAction,
  deps: BridgeProtocolOutboundDeps,
  permissionDecision?: PermissionDecisionPayload | null,
): string | null {
  if (action.type === "permission.decide") {
    const party = deps.getParty();
    if (!party) {
      return null;
    }
    return dispatchPermissionDecision(action, deps, party, permissionDecision);
  }
  if (action.type === "chat.sendMessage") {
    return dispatchChatMessage(action, deps);
  }
  if (action.type === "chat.attachContext") {
    return dispatchAttachContext(action, deps);
  }
  if (action.type === "affair.resume") {
    return dispatchAffairResume(action, deps);
  }
  return null;
}

/**
 * @param action 决策动作
 * @param deps 依赖
 * @param party 寻址
 * @param permissionDecision 已裁决载荷
 * @returns 错误或 null
 */
function dispatchPermissionDecision(
  action: BridgeUiAction,
  deps: BridgeProtocolOutboundDeps,
  party: OutboundParty,
  permissionDecision?: PermissionDecisionPayload | null,
): string | null {
  if (action.type !== "permission.decide" || !permissionDecision) {
    return null;
  }
  if (deps.isSessionAuthenticated()) {
    deps.broadcast(buildPermissionDecisionEnvelope(party, permissionDecision));
  }
  return null;
}

/**
 * @param action 发消息
 * @param deps 依赖
 * @param party 寻址
 * @returns 错误或 null
 */
function dispatchChatMessage(
  action: BridgeUiAction,
  deps: BridgeProtocolOutboundDeps,
): string | null {
  if (action.type !== "chat.sendMessage") {
    return null;
  }
  const party = requireOutboundParty(deps);
  if (!party.ok) {
    return party.message;
  }
  const built = buildUserChatMessage(action.text, action.affairId);
  if (!built.ok) {
    return built.error.message;
  }
  deps.broadcast(buildChatMessageEnvelope(party.value, built.value));
  return null;
}

/**
 * @param action 附加上下文
 * @param deps 依赖
 * @param party 寻址
 * @returns 错误或 null
 */
function dispatchAttachContext(
  action: BridgeUiAction,
  deps: BridgeProtocolOutboundDeps,
): string | null {
  if (action.type !== "chat.attachContext") {
    return null;
  }
  const built = buildContextAttach(
    action.text,
    action.target,
    action.contentKind,
    action.affairId,
  );
  if (!built.ok) {
    return built.error.message;
  }
  const party = deps.getParty();
  const canSend = deps.isSessionAuthenticated() && party !== null;
  if (canSend && (deps.hasActiveCall() || action.target === "affair")) {
    deps.broadcast(buildContextAttachEnvelope(party, built.value));
    return null;
  }
  const queued = deps.pendingContext.enqueue({
    text: built.value.text,
    contentKind: action.contentKind,
    target: action.target,
    affairId: action.affairId ?? null,
  });
  return queued.ok ? null : queued.message;
}

/**
 * @param action resume
 * @param deps 依赖
 * @param party 寻址
 * @returns 错误或 null
 */
function dispatchAffairResume(
  action: BridgeUiAction,
  deps: BridgeProtocolOutboundDeps,
): string | null {
  if (action.type !== "affair.resume") {
    return null;
  }
  const party = requireOutboundParty(deps);
  if (!party.ok) {
    return party.message;
  }
  const affair = deps.getAffair(action.affairId);
  if (!affair) {
    return "找不到对应事务";
  }
  if (!canTransitionAffairStatus(affair.status, "running")) {
    return `affair 状态 ${affair.status} 不可 resume`;
  }
  deps.broadcast(
    buildAffairResumeEnvelope(party.value, {
      ...affair,
      status: "running",
      blockedReason: null,
      resumeCondition: null,
    }),
  );
  return null;
}

/**
 * 出站须已认证 session 且有 phone 寻址。
 *
 * @param deps 依赖
 * @returns party 或错误
 */
function requireOutboundParty(
  deps: BridgeProtocolOutboundDeps,
): { ok: true; value: OutboundParty } | { ok: false; message: string } {
  if (!deps.isSessionAuthenticated()) {
    return { ok: false, message: "需要已认证电话会话才能出站" };
  }
  const party = deps.getParty();
  if (!party) {
    return { ok: false, message: "无已配对电话，无法出站" };
  }
  return { ok: true, value: party };
}

/**
 * session.accepted 后刷出 pending context。
 *
 * @param deps 依赖
 */
export function flushPendingContext(deps: BridgeProtocolOutboundDeps): void {
  if (!deps.isSessionAuthenticated()) {
    return;
  }
  const party = deps.getParty();
  if (!party) {
    return;
  }
  for (const item of deps.pendingContext.drain()) {
    const built = buildContextAttach(item.text, item.target, item.contentKind, item.affairId);
    if (!built.ok) {
      continue;
    }
    deps.broadcast(buildContextAttachEnvelope(party, built.value));
  }
}
