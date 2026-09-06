/**
 * Affair 状态枚举与合法迁移。
 *
 * 职责：声明 affair status 集合，并判断状态迁移是否允许。
 * 不拥有：事务簿持久化、用户验收 UI、把 job.completed 映射为 closed。
 * 纯函数：无 I/O；`job.completed` 不得直接推导 `closed`。
 */

/** affair.status 合法取值，与 schemas/affair.schema.json 对齐 */
export const AFFAIR_STATUSES = [
  "clarifying",
  "ready",
  "delegated",
  "running",
  "blocked",
  "paused",
  "waiting_acceptance",
  "closed",
  "canceled",
] as const;

/** Affair 生命周期状态 */
export type AffairStatus = (typeof AFFAIR_STATUSES)[number];

const AFFAIR_TRANSITIONS: Record<AffairStatus, readonly AffairStatus[]> = {
  clarifying: ["ready", "canceled"],
  ready: ["delegated", "clarifying", "canceled"],
  delegated: ["running", "blocked", "paused", "canceled"],
  running: ["blocked", "paused", "waiting_acceptance", "canceled"],
  blocked: ["running", "paused", "canceled"],
  paused: ["running", "blocked", "canceled"],
  waiting_acceptance: ["closed", "running", "canceled", "blocked"],
  closed: [],
  canceled: [],
};

/**
 * 判断值是否为合法 AffairStatus。
 *
 * @param value 待检测值
 * @returns 是否属于 AFFAIR_STATUSES
 */
export function isAffairStatus(value: unknown): value is AffairStatus {
  return typeof value === "string" && (AFFAIR_STATUSES as readonly string[]).includes(value);
}

/**
 * 判断 affair 状态迁移是否允许。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 是否在允许表中；终态 closed/canceled 无出边
 */
export function canTransitionAffairStatus(from: AffairStatus, to: AffairStatus): boolean {
  if (from === to) {
    return true;
  }
  return AFFAIR_TRANSITIONS[from].includes(to);
}
