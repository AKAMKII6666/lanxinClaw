/**
 * 低风险只读任务种类目录。
 *
 * 职责：声明可被 local-safe runtime 执行的固定任务 id 与所需权限。
 * 不拥有：真实执行、companion 权限裁决、affair 关闭。
 * 纯函数：仅常量与解析。
 */

/** 允许的低风险任务种类（白名单；禁止任意命令） */
export const LOW_RISK_TASK_KINDS = ["workspace.list_root", "git.status"] as const;

/** 低风险任务种类 */
export type LowRiskTaskKind = (typeof LOW_RISK_TASK_KINDS)[number];

/** goal 中嵌入种类的前缀，便于 runtime 解析且避免任意 shell */
export const LOW_RISK_GOAL_PREFIX = "[lanxin-safe:";

/**
 * 构造可被 local-safe runtime 识别的 goal。
 *
 * @param kind 任务种类
 * @param humanHint 人类可读摘要（不得含凭据）
 * @returns goal 文本
 */
export function buildLowRiskGoal(kind: LowRiskTaskKind, humanHint: string): string {
  return `${LOW_RISK_GOAL_PREFIX}${kind}] ${humanHint}`;
}

/**
 * 从 goal 解析白名单任务种类；无法识别则返回 null。
 *
 * @param goal job.goal
 * @returns 种类或 null
 */
export function parseLowRiskTaskKind(goal: string): LowRiskTaskKind | null {
  if (!goal.startsWith(LOW_RISK_GOAL_PREFIX)) {
    return null;
  }
  const end = goal.indexOf("]");
  if (end < 0) {
    return null;
  }
  const raw = goal.slice(LOW_RISK_GOAL_PREFIX.length, end);
  if ((LOW_RISK_TASK_KINDS as readonly string[]).includes(raw)) {
    return raw as LowRiskTaskKind;
  }
  return null;
}

/**
 * 某低风险任务所需的最小权限集合。
 *
 * @param kind 任务种类
 * @returns 权限 id 列表
 */
export function requiredPermissionsForLowRisk(kind: LowRiskTaskKind): readonly string[] {
  switch (kind) {
    case "workspace.list_root":
      return ["workspace.read"];
    case "git.status":
      return ["git.read"];
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
