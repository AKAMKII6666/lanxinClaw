/** 收件人、原消息、消费凭据在同一镜像提交；落盘失败保留待投递项。 */
import { validateMessage, type ChatReadReceiptPayload, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { PendingContextItem, PendingContextQueue } from "../../chat/channel/pending-context.js";
import type { ApplyProtocolResult, CompanionBackendState, ChatReceiptRecord } from "../../state/types.js";

export function applyMessageReceipt(
  state: CompanionBackendState, pending: PendingContextQueue, envelope: ProtocolEnvelope,
  persist: () => void,
): ApplyProtocolResult {
  const checked = validateMessage(envelope);
  if (!checked.ok) return failure("protocol_invalid", checked.error.message, false);
  const payload = envelope.payload as unknown as ChatReadReceiptPayload;
  const sourceId = payload.chatMessageId ?? payload.attachId;
  const sourceKind = payload.chatMessageId ? "message" : "context_attach";
  const phoneDeviceId = envelope.source.deviceId;
  const desktopDeviceId = envelope.target.deviceId;
  if (envelope.source.kind !== "phone") return failure("receipt_source_invalid", "消费回执必须由电话提供", false);
  const sameSource = (receipt: ChatReceiptRecord): boolean => receipt.phoneDeviceId === phoneDeviceId &&
    receipt.desktopDeviceId === desktopDeviceId && receipt.chatMessageId === payload.chatMessageId && receipt.attachId === payload.attachId;
  const conflict = state.chatReceipts.find((r) => r.receiptMessageId === envelope.messageId && !sameSource(r));
  if (conflict) return failure("receipt_request_conflict", "回执请求 ID 已用于另一消息", false);
  if (state.chatReceipts.some(sameSource)) return { ok: true, duplicate: true, envelope };
  const previous = pending.list();
  const item = previous.find((entry) => entry.sourceId === sourceId && entry.sourceKind === sourceKind &&
    entry.phoneDeviceId === phoneDeviceId && entry.desktopDeviceId === desktopDeviceId);
  if (!item) return failure("receipt_message_unknown", "回执没有匹配的原消息和收件人", false);
  return commitReceipt(state, pending, previous, item, envelope, { ...payload, phoneDeviceId, desktopDeviceId, receiptMessageId: envelope.messageId }, persist);
}

function commitReceipt(
  state: CompanionBackendState, pending: PendingContextQueue, previous: PendingContextItem[], item: PendingContextItem,
  envelope: ProtocolEnvelope, receipt: ChatReceiptRecord, persist: () => void,
): ApplyProtocolResult {
  const before = [...state.chatReceipts];
  state.chatReceipts.push(receipt);
  pending.restore(previous.filter((entry) => entry.pendingId !== item.pendingId));
  try { persist(); }
  catch {
    state.chatReceipts.splice(0, state.chatReceipts.length, ...before);
    pending.restore(previous);
    return failure("receipt_commit_failed", "消费回执保存失败，请重试原请求", true);
  }
  return { ok: true, envelope };
}

function failure(code: string, message: string, retryable: boolean): ApplyProtocolResult {
  return { ok: false, code, message, retryable };
}
