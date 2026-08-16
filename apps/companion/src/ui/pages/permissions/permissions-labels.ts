/**
 * 权限页文案映射。
 *
 * 职责：permission id / 授予态 / 决策 / 请求方 → 中文标签。
 * 不拥有：gate、bridge。
 * 纯函数：仅映射。
 */

import type { PermissionDecisionChoice } from "../../../permissions/views.js";

/** permission id 文案 */
export const PERMISSION_ID_LABEL: Record<string, string> = {
  "workspace.read": "读工作区",
  "workspace.write": "写工作区",
  "command.run": "运行命令",
  "network.access": "网络访问",
  "git.read": "Git 读取",
  "git.write": "Git 写入",
  "secrets.read": "读取机密",
  "desktop.control": "桌面控制",
};

/** 授予态文案 */
export const GRANT_STATUS_LABEL: Record<string, string> = {
  allowed: "已允许",
  pending: "待确认",
  needs_confirm: "需确认",
  denied: "已拒绝",
};

/** 请求方文案 */
export const REQUESTER_LABEL: Record<string, string> = {
  "zhang-boss": "张老板",
  companion: "Companion",
  "openclaw-adapter": "OpenClaw adapter",
};

/** 决策按钮文案 */
export const DECISION_LABEL: Record<PermissionDecisionChoice, string> = {
  allow_once: "允许一次",
  allow_for_job: "本任务允许",
  deny: "拒绝",
  require_more_context: "需要更多上下文",
};

/**
 * @param map 映射表
 * @param key 键
 * @returns 标签或原文
 */
export function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
