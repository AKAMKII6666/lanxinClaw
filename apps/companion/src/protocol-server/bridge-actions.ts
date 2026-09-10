import { queueDesktopMessage } from "./message-outbox.js";
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
import type { BridgeActionDelivery, BridgeUiAction } from "../bridge/contract.js";
import {
  buildContextAttach,
  buildUserChatMessage,
} from "../chat/build-outbound.js";
import type { PendingContextQueue } from "../chat/channel/pending-context.js";
import {
  buildAffairResumeEnvelope,
  buildAffairUpdateEnvelope,
  buildPermissionDecisionEnvelope,
  type OutboundParty,
} from "./outbound-envelopes.js";
import {
  deliveryFor,
  ok,
  rejected,
  type BridgeProtocolActionDispatchResult,
} from "./bridge-action-delivery.js";

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
  /** pending flush 后记录后继投递回执 */
  recordActionDelivery?: (delivery: BridgeActionDelivery) => void;
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
): BridgeProtocolActionDispatchResult {
  if (action.type === "permission.decide") {
    const party = deps.getParty();
    if (!party) {
      return ok(deliveryFor(action, deps, "applied_locally", "权限已在电脑端应用；当前没有可投递的电话 session", "phone_not_available"));
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
  if (action.type === "affair.pause") {
    return dispatchAffairPause(action, deps);
  }
  if (action.type === "affair.accept" || action.type === "affair.cancel") {
    return rejected(action, deps, "事务关闭必须调用共同协调器", "affair_action_required");
  }
  if (action.type === "affair.requestRevision") {
    return dispatchAffairRevision(action, deps);
  }
  if (action.type === "affair.requestAcceptance") {
    return dispatchAffairStatusReport(action, deps);
  }
  return ok(null);
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
): BridgeProtocolActionDispatchResult {
  if (action.type !== "permission.decide" || !permissionDecision) {
    return ok(null);
  }
  if (deps.isSessionAuthenticated()) {
    deps.broadcast(buildPermissionDecisionEnvelope(party, permissionDecision));
    return ok(deliveryFor(action, deps, "sent_to_phone", "权限裁决已发送给电话端", null));
  }
  return ok(deliveryFor(action, deps, "applied_locally", "权限已在电脑端应用；等待电话 session 后同步", "session_not_authenticated"));
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
): BridgeProtocolActionDispatchResult {
  if (action.type !== "chat.sendMessage") {
    return ok(null);
  }
  const built = buildUserChatMessage(action.text, action.affairId);
  if (!built.ok) {
    return rejected(action, deps, built.error.message, built.error.code);
  }
  return queueDesktopMessage(action, built.value, deps);
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
): BridgeProtocolActionDispatchResult {
  if (action.type !== "chat.attachContext") {
    return ok(null);
  }
  const built = buildContextAttach(
    action.text,
    action.target,
    action.contentKind,
    action.affairId,
  );
  if (!built.ok) {
    return rejected(action, deps, built.error.message, built.error.code);
  }
  return queueDesktopMessage(action, built.value, deps);
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
): BridgeProtocolActionDispatchResult {
  if (action.type !== "affair.resume") {
    return ok(null);
  }
  const party = requireOutboundParty(deps);
  if (!party.ok) {
    return rejected(action, deps, party.message, party.code);
  }
  const affair = deps.getAffair(action.affairId);
  if (!affair) {
    return rejected(action, deps, "找不到对应事务", "affair_not_found");
  }
  if (!canTransitionAffairStatus(affair.status, "running")) {
    return rejected(action, deps, `affair 状态 ${affair.status} 不可 resume`, "affair_resume_rejected");
  }
  deps.broadcast(
    buildAffairResumeEnvelope(party.value, {
      ...affair,
      status: "running",
      blockedReason: null,
      resumeCondition: null,
    }),
  );
  return ok(deliveryFor(action, deps, "sent_to_phone", "继续处理请求已发送给电话端", null));
}

function dispatchAffairPause(
  action: BridgeUiAction,
  deps: BridgeProtocolOutboundDeps,
): BridgeProtocolActionDispatchResult {
  if (action.type !== "affair.pause") {
    return ok(null);
  }
  const party = requireOutboundParty(deps);
  if (!party.ok) {
    return rejected(action, deps, party.message, party.code);
  }
  const affair = deps.getAffair(action.affairId);
  if (!affair) {
    return rejected(action, deps, "找不到对应事务", "affair_not_found");
  }
  if (!canTransitionAffairStatus(affair.status, "paused")) {
    return rejected(action, deps, `affair 状态 ${affair.status} 不可暂停`, "affair_pause_rejected");
  }
  deps.broadcast(
    buildAffairUpdateEnvelope(party.value, {
      ...affair,
      status: "paused",
    }),
  );
  return ok(deliveryFor(action, deps, "sent_to_phone", "暂停请求已发送给电话端", null));
}

function dispatchAffairRevision(
  action: BridgeUiAction,
  deps: BridgeProtocolOutboundDeps,
): BridgeProtocolActionDispatchResult {
  if (action.type !== "affair.requestRevision") {
    return ok(null);
  }
  const resume = dispatchAffairResume({ type: "affair.resume", affairId: action.affairId }, deps);
  if (resume.error) {
    return resume;
  }
  return attachSystemNoteToAffair(
    action.affairId,
    "桌面用户认为当前结果还没有达到完成标准，请张老板重新评估并继续推进事务。",
    deps,
    action,
  );
}

function dispatchAffairStatusReport(
  action: BridgeUiAction,
  deps: BridgeProtocolOutboundDeps,
): BridgeProtocolActionDispatchResult {
  if (action.type !== "affair.requestAcceptance") {
    return ok(null);
  }
  return attachSystemNoteToAffair(
    action.affairId,
    "桌面用户请求张老板回报当前事务状态，并说明是否达到完成标准。",
    deps,
    action,
  );
}

function attachSystemNoteToAffair(
  affairId: string,
  text: string,
  deps: BridgeProtocolOutboundDeps,
  action?: BridgeUiAction,
): BridgeProtocolActionDispatchResult {
  if (!deps.getAffair(affairId)) {
    return rejected(action ?? { type: "affair.requestAcceptance", affairId }, deps, "找不到对应事务", "affair_not_found");
  }
  const built = buildContextAttach(text, "affair", "note", affairId);
  if (!built.ok) {
    return rejected(action ?? { type: "affair.requestAcceptance", affairId }, deps, built.error.message, built.error.code);
  }
  return queueDesktopMessage(action ?? { type: "affair.requestAcceptance", affairId }, built.value, deps);
}

/**
 * 出站须已认证 session 且有 phone 寻址。
 *
 * @param deps 依赖
 * @returns party 或错误
 */
function requireOutboundParty(
  deps: BridgeProtocolOutboundDeps,
): { ok: true; value: OutboundParty } | { ok: false; code: string; message: string } {
  if (!deps.isSessionAuthenticated()) {
    return { ok: false, code: "session_required", message: "需要已认证电话会话才能出站" };
  }
  const party = deps.getParty();
  if (!party) {
    return { ok: false, code: "phone_required", message: "无已配对电话，无法出站" };
  }
  return { ok: true, value: party };
}

export { flushPendingContext } from "./message-outbox.js";
