/**
 * 张老板页文案映射。
 *
 * 职责：presence / author / contentKind → 中文标签。
 * 不拥有：chat 发送、权限。
 * 纯函数：仅映射。
 */

import type {
  ChatContentKind,
  ZhangBossPresenceStatus,
} from "../../../chat/views.js";

/** 在线态文案 */
export const PRESENCE_LABEL: Record<ZhangBossPresenceStatus, string> = {
  offline: "离线",
  online: "在线",
  in_call: "通话中",
  supervising: "正在盯事务",
  waiting_user: "等待用户",
};

/** 作者文案 */
export const AUTHOR_LABEL: Record<string, string> = {
  user: "用户",
  "zhang-boss": "张老板",
  companion: "Companion",
};

/** 内容种类文案 */
export const CONTENT_KIND_LABEL: Record<ChatContentKind, string> = {
  path: "路径",
  log: "日志",
  url: "URL",
  note: "说明",
};

/**
 * @param map 映射表
 * @param key 键
 * @returns 标签或原文
 */
export function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
