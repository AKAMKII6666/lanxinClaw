/**
 * 权限决策枚举与效果语义。
 *
 * 职责：声明 permission.decision 取值，并映射为门禁效果标签。
 * 不拥有：companion 最终授权、执行副作用、affair 关闭。
 * 纯函数：无 I/O；效果标签仅描述语义，不执行授予。
 */

/** 与 schemas/permission.schema.json decision 对齐 */
export const PERMISSION_DECISIONS = [
  "allow_once",
  "allow_for_job",
  "deny",
  "require_more_context",
] as const;

/** 用户/桌面侧权限决策 */
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

/**
 * 决策对应的门禁效果标签。
 * `request_clarification` 表示回到澄清，不得静默重试高风险动作。
 */
export type PermissionDecisionEffect =
  | "grant_once"
  | "grant_for_job"
  | "deny_action"
  | "request_clarification";

const DECISION_EFFECT: Record<PermissionDecision, PermissionDecisionEffect> = {
  allow_once: "grant_once",
  allow_for_job: "grant_for_job",
  deny: "deny_action",
  require_more_context: "request_clarification",
};

/**
 * 判断值是否为合法 PermissionDecision。
 *
 * @param value 待检测值
 * @returns 是否属于 PERMISSION_DECISIONS
 */
export function isPermissionDecision(value: unknown): value is PermissionDecision {
  return (
    typeof value === "string" && (PERMISSION_DECISIONS as readonly string[]).includes(value)
  );
}

/**
 * 将决策映射为门禁效果标签；未知决策按 deny 处理。
 *
 * @param decision 决策值
 * @returns 效果标签
 */
export function effectOfPermissionDecision(
  decision: PermissionDecision | string,
): PermissionDecisionEffect {
  if (isPermissionDecision(decision)) {
    return DECISION_EFFECT[decision];
  }
  return "deny_action";
}
