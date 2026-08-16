/**
 * 权限裁决反馈文案。
 *
 * 职责：根据 gate 裁决结果生成用户可见提示。
 * 不拥有：gate 状态、bridge、UI 渲染。
 * 纯函数：无 I/O。
 */

import type { PermissionDecisionChoice } from "../views.js";
import type { GateDecisionResult } from "./types.js";

/**
 * @param result gate 裁决结果
 * @param decision 用户选择
 * @returns 提示文案；失败返回 null
 */
export function permissionDecisionInfoText(
  result: GateDecisionResult,
  decision: PermissionDecisionChoice,
): string | null {
  if (!result.ok) {
    return null;
  }
  if (result.needsClarification) {
    return "已要求更多上下文；相关动作不会静默重试。";
  }
  if (result.actionBlocked) {
    return "已拒绝；本 job 不得继续该权限动作。";
  }
  if (decision === "allow_once") {
    return "已允许一次；下次精确动作后授予将消耗。";
  }
  return "已按本任务范围允许。";
}
