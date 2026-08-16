/**
 * 张老板页本地线程/附加历史辅助。
 *
 * 职责：构造本地展示用的用户消息与 attach 历史条目。
 * 不拥有：bridge 提交、权限、OpenClaw。
 * 纯函数：无 I/O。
 */

import type {
  ChatContentKind,
  ContextAttachHistoryView,
  ZhangBossChatMessageView,
} from "../../../chat/views.js";

/**
 * @param text 用户正文
 * @returns 本地消息
 */
export function buildLocalUserMessage(text: string): ZhangBossChatMessageView {
  return {
    messageId: `local_${Date.now()}`,
    authorKind: "user",
    text,
    sentAt: new Date().toISOString(),
  };
}

/**
 * @param text 正文
 * @param kind 种类
 * @param targetLabel 目标标签
 * @param deliveryLabel 通道标签
 * @returns 附加历史
 */
export function buildLocalAttachHistory(
  text: string,
  kind: ChatContentKind,
  targetLabel: string,
  deliveryLabel: string,
): ContextAttachHistoryView {
  return {
    attachId: `local_attach_${Date.now()}`,
    targetLabel,
    contentKind: kind,
    text,
    deliveryLabel,
    attachedAt: new Date().toISOString(),
  };
}
