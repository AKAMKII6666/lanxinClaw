/**
 * 张老板页出站 chat / context_attach 构造。
 *
 * 职责：把用户输入建成可通过协议校验的载荷；标记为 untrusted。
 * 不拥有：发送到 phone、权限授予、把文本当系统指令执行。
 * 纯函数：无 I/O；失败时返回错误，不抛。
 */

import {
  createAttachId,
  createChatMessageId,
  validatePayloadForType,
  type ChatContextAttachPayload,
  type ChatMessagePayload,
  type ValidateResult,
} from "@lanxin-claw/protocol";
import type { ChatAttachTarget, ChatContentKind } from "./views.js";

/**
 * 粗略猜测内容种类，供 UI 默认选择；用户可改。
 *
 * @param text 用户输入
 * @returns 猜测的 contentKind
 */
export function guessContentKind(text: string): ChatContentKind {
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return "url";
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.includes("\\")) {
    return "path";
  }
  if (trimmed.includes("\n") || /\berror\b|\bfail(ed|ure)?\b/i.test(trimmed)) {
    return "log";
  }
  return "note";
}

/**
 * 构造用户 chat.message 载荷；不得当系统指令。
 *
 * @param text 用户输入正文
 * @param affairId 可选关联事务
 * @param sentAt 可选发送时间；默认 now
 * @returns 校验后的载荷或失败
 */
export function buildUserChatMessage(
  text: string,
  affairId?: string | null,
  sentAt?: string,
): ValidateResult<ChatMessagePayload> {
  const payload: ChatMessagePayload = {
    chatMessageId: createChatMessageId(),
    text,
    authorKind: "user",
    sentAt: sentAt ?? new Date().toISOString(),
  };
  if (affairId !== undefined) {
    payload.affairId = affairId;
  }
  return validatePayloadForType("chat.message", payload) as ValidateResult<ChatMessagePayload>;
}

/**
 * 构造 chat.context_attach 载荷；仍为 untrusted input。
 *
 * @param text 附加正文
 * @param target 附加目标
 * @param contentKind 内容种类
 * @param affairId target=affair 时必填
 * @param sentAt 可选发送时间
 * @returns 校验后的载荷或失败
 */
export function buildContextAttach(
  text: string,
  target: ChatAttachTarget,
  contentKind: ChatContentKind,
  affairId?: string | null,
  sentAt?: string,
): ValidateResult<ChatContextAttachPayload> {
  const payload: ChatContextAttachPayload = {
    attachId: createAttachId(),
    text,
    target,
    contentKind,
    sentAt: sentAt ?? new Date().toISOString(),
  };
  if (affairId !== undefined && affairId !== null) {
    payload.affairId = affairId;
  }
  return validatePayloadForType(
    "chat.context_attach",
    payload,
  ) as ValidateResult<ChatContextAttachPayload>;
}
