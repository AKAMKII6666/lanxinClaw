/**
 * Chat payload 校验。
 *
 * 职责：按 chat.schema.json 校验 chat.* 载荷。
 * 不拥有：把 chat 当系统指令执行。
 * 纯函数：无 I/O；文本一律 untrusted。
 */

import type {
  ChatContextAttachPayload,
  ChatMessagePayload,
  ChatReadReceiptPayload,
} from "../../../messages/payloads/session.js";
import {
  expectDateTime,
  expectEnum,
  expectNonEmptyString,
  expectObject,
  expectStringOrNull,
  optionalField,
  rejectUnknownKeys,
} from "../../primitives.js";
import type { ValidateResult } from "../../result.js";

/**
 * 校验 chat.message。
 *
 * @param value 待检 payload
 * @returns ChatMessagePayload 或失败
 */
export function validateChatMessagePayload(value: unknown): ValidateResult<ChatMessagePayload> {
  const obj = expectObject(value, "chat.message");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["chatMessageId", "text", "affairId", "authorKind", "sentAt"],
    "chat.message",
  );
  if (!keys.ok) {
    return keys;
  }
  const chatMessageId = expectNonEmptyString(obj.value.chatMessageId, "chatMessageId");
  if (!chatMessageId.ok) {
    return chatMessageId;
  }
  const text = expectNonEmptyString(obj.value.text, "text");
  if (!text.ok) {
    return text;
  }
  const authorKind = expectEnum(obj.value.authorKind, "authorKind", [
    "user",
    "zhang-boss",
    "companion",
  ] as const);
  if (!authorKind.ok) {
    return authorKind;
  }
  const sentAt = expectDateTime(obj.value.sentAt, "sentAt");
  if (!sentAt.ok) {
    return sentAt;
  }
  const affairId = optionalField(obj.value, "affairId", (v) => expectStringOrNull(v, "affairId"));
  if (!affairId.ok) {
    return affairId;
  }
  const payload: ChatMessagePayload = {
    chatMessageId: chatMessageId.value,
    text: text.value,
    authorKind: authorKind.value,
    sentAt: sentAt.value,
  };
  if (affairId.value !== undefined) {
    payload.affairId = affairId.value;
  }
  return { ok: true, value: payload };
}

/**
 * 校验 chat.context_attach。
 *
 * @param value 待检 payload
 * @returns ChatContextAttachPayload 或失败
 */
export function validateChatContextAttachPayload(
  value: unknown,
): ValidateResult<ChatContextAttachPayload> {
  const obj = expectObject(value, "chat.context_attach");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["attachId", "text", "target", "affairId", "contentKind", "sentAt"],
    "chat.context_attach",
  );
  if (!keys.ok) {
    return keys;
  }
  const attachId = expectNonEmptyString(obj.value.attachId, "attachId");
  if (!attachId.ok) {
    return attachId;
  }
  const text = expectNonEmptyString(obj.value.text, "text");
  if (!text.ok) {
    return text;
  }
  const target = expectEnum(obj.value.target, "target", ["active_call", "affair"] as const);
  if (!target.ok) {
    return target;
  }
  const contentKind = expectEnum(obj.value.contentKind, "contentKind", [
    "path",
    "log",
    "url",
    "note",
  ] as const);
  if (!contentKind.ok) {
    return contentKind;
  }
  const sentAt = expectDateTime(obj.value.sentAt, "sentAt");
  if (!sentAt.ok) {
    return sentAt;
  }
  const affairId = optionalField(obj.value, "affairId", (v) => expectStringOrNull(v, "affairId"));
  if (!affairId.ok) {
    return affairId;
  }
  if (target.value === "affair") {
    if (typeof affairId.value !== "string" || affairId.value.length < 1) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "target=affair 时 affairId 必须为非空字符串",
          retryable: false,
        },
      };
    }
  }
  const payload: ChatContextAttachPayload = {
    attachId: attachId.value,
    text: text.value,
    target: target.value,
    contentKind: contentKind.value,
    sentAt: sentAt.value,
  };
  if (affairId.value !== undefined) {
    payload.affairId = affairId.value;
  }
  return { ok: true, value: payload };
}

/**
 * 校验 chat.read_receipt。
 *
 * @param value 待检 payload
 * @returns ChatReadReceiptPayload 或失败
 */
export function validateChatReadReceiptPayload(
  value: unknown,
): ValidateResult<ChatReadReceiptPayload> {
  const obj = expectObject(value, "chat.read_receipt");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["chatMessageId", "attachId", "readAt"],
    "chat.read_receipt",
  );
  if (!keys.ok) {
    return keys;
  }
  const readAt = expectDateTime(obj.value.readAt, "readAt");
  if (!readAt.ok) {
    return readAt;
  }
  const chatMessageId = optionalField(obj.value, "chatMessageId", (v) =>
    expectNonEmptyString(v, "chatMessageId"),
  );
  if (!chatMessageId.ok) {
    return chatMessageId;
  }
  const attachId = optionalField(obj.value, "attachId", (v) => expectNonEmptyString(v, "attachId"));
  if (!attachId.ok) {
    return attachId;
  }
  if (chatMessageId.value === undefined && attachId.value === undefined) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "read_receipt 须提供 chatMessageId 或 attachId",
        retryable: false,
      },
    };
  }
  const payload: ChatReadReceiptPayload = { readAt: readAt.value };
  if (chatMessageId.value !== undefined) {
    payload.chatMessageId = chatMessageId.value;
  }
  if (attachId.value !== undefined) {
    payload.attachId = attachId.value;
  }
  return { ok: true, value: payload };
}

