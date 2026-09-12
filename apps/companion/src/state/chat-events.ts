/** 原消息 ID 去重，重连重复发送不能新增气泡或替换已保存原文。 */
import type { ChatContextAttachPayload, ChatMessagePayload, ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { ApplyProtocolResult, CompanionBackendState } from "./types.js";

export function applyChatEvent(state: CompanionBackendState, envelope: ProtocolEnvelope): ApplyProtocolResult {
  if (envelope.type === "chat.message") {
    const payload = envelope.payload as unknown as ChatMessagePayload;
    const previous = state.chatMessages.find((item) => item.chatMessageId === payload.chatMessageId);
    if (previous) return duplicate(previous, payload, envelope);
    state.chatMessages.push(payload);
  } else {
    const payload = envelope.payload as unknown as ChatContextAttachPayload;
    const previous = state.contextAttachments.find((item) => item.attachId === payload.attachId);
    if (previous) return duplicate(previous, payload, envelope);
    state.contextAttachments.push(payload);
  }
  return { ok: true, envelope };
}

function duplicate(
  old: ChatMessagePayload | ChatContextAttachPayload,
  next: ChatMessagePayload | ChatContextAttachPayload, envelope: ProtocolEnvelope,
): ApplyProtocolResult {
  if (old.text !== next.text || (old.affairId ?? null) !== (next.affairId ?? null)) {
    return { ok: false, code: "message_id_content_conflict", message: "原消息 ID 不能替换内容或事务", retryable: false };
  }
  return { ok: true, duplicate: true, envelope };
}
