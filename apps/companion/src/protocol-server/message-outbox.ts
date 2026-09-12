/** 桌面消息先持久化原 ID 与收件设备；发送后保留，直到消费回执确认。 */
import type { ChatContextAttachPayload, ChatMessagePayload } from "@lanxin-claw/protocol";
import type { BridgeUiAction } from "../bridge/contract.js";
import type { PendingContextItem } from "../chat/channel/pending-context.js";
import type { BridgeProtocolOutboundDeps } from "./bridge-actions.js";
import { createBridgeActionReceiptId, deliveryFor, ok, rejected, type BridgeProtocolActionDispatchResult } from "./bridge-action-delivery.js";
import { buildChatMessageEnvelope, buildContextAttachEnvelope } from "./outbound-envelopes.js";

/** 排队成功只证明已保存；发送成功也不代表通话消费。 */
export function queueDesktopMessage(
  action: BridgeUiAction,
  payload: ChatMessagePayload | ChatContextAttachPayload,
  deps: BridgeProtocolOutboundDeps,
): BridgeProtocolActionDispatchResult {
  const party = deps.getParty();
  if (!party) return rejected(action, deps, "需要先连接电话以确认消息收件人", "phone_required");
  const canSend = deps.isSessionAuthenticated();
  const delivery = deliveryFor(action, deps, canSend ? "sent_to_phone" : "queued_until_session",
    canSend ? "消息已发送，等待张老板接收" : "消息已保存，电话重连后继续发送", canSend ? null : "session_not_authenticated");
  const isMessage = "chatMessageId" in payload;
  const queued = deps.pendingContext.enqueue({
    ...party, sourceId: isMessage ? payload.chatMessageId : payload.attachId,
    sourceKind: isMessage ? "message" : "context_attach", text: payload.text,
    contentKind: isMessage ? "note" : payload.contentKind, target: isMessage ? "active_call" : payload.target,
    affairId: payload.affairId ?? null, enqueuedAt: payload.sentAt,
    actionReceiptId: delivery.actionReceiptId, jobId: delivery.jobId,
  });
  if (!queued.ok) return rejected(action, deps, queued.message, queued.code);
  if (canSend) sendPendingMessage(queued.item, deps);
  return ok(delivery);
}

/** 复用原消息 ID、原接收人、原时间；不依赖 active affair，也不出队。 */
export function sendPendingMessage(item: PendingContextItem, deps: BridgeProtocolOutboundDeps): boolean {
  const party = deps.getParty();
  if (!party || !deps.isSessionAuthenticated() || !item.sourceId ||
      item.phoneDeviceId !== party.phoneDeviceId || item.desktopDeviceId !== party.desktopDeviceId) return false;
  const common = { text: item.text, sentAt: item.enqueuedAt, affairId: item.affairId };
  if (item.sourceKind === "message") {
    deps.broadcast(buildChatMessageEnvelope(party, { ...common, chatMessageId: item.sourceId, authorKind: "user" }));
  } else {
    deps.broadcast(buildContextAttachEnvelope(party, { ...common, attachId: item.sourceId,
      contentKind: item.contentKind, target: item.target }));
  }
  return true;
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
  for (const item of deps.pendingContext.list()) {
    if (!sendPendingMessage(item, deps)) continue;
    deps.recordActionDelivery?.({
      actionReceiptId: item.actionReceiptId ?? createBridgeActionReceiptId(),
      status: "sent_to_phone",
      affairId: item.affairId,
      jobId: item.jobId ?? (item.affairId ? deps.getAffair(item.affairId)?.currentJobId ?? null : null),
      deliveredAt: new Date().toISOString(),
      reasonCode: null,
      message: "已从待投递队列发送给电话端，等待张老板消费或回报",
    });
  }
}
