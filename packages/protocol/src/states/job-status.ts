/**
 * Job 状态枚举与合法迁移。
 *
 * 职责：声明 job status 集合，并判断状态迁移是否允许。
 * 不拥有：OpenClaw run 生命周期、affair 关闭、权限授予裁决。
 * 纯函数：无 I/O；`completed` 只表示 worker 完成，不表示 affair closed。
 */

/** job.status 合法取值，与 schemas/job.schema.json 对齐 */
export const JOB_STATUSES = [
  "queued",
  "running",
  "needs_permission",
  "blocked",
  "completed",
  "failed",
  "canceled",
] as const;

/** Job 执行状态 */
export type JobStatus = (typeof JOB_STATUSES)[number];

const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "needs_permission", "completed", "canceled"],
  running: ["needs_permission", "blocked", "completed", "failed", "canceled"],
  needs_permission: ["running", "blocked", "failed", "canceled"],
  blocked: ["running", "failed", "canceled"],
  // 仅用于空壳 completed 纠为 terminal_without_result；真完成不得被非终态复活。
  completed: ["blocked"],
  failed: [],
  canceled: [],
};

/**
 * 判断值是否为合法 JobStatus。
 *
 * @param value 待检测值
 * @returns 是否属于 JOB_STATUSES
 */
export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

/**
 * 判断 job 状态迁移是否允许。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 是否在允许表中；终态无出边
 */
export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  if (from === to) {
    return true;
  }
  return JOB_TRANSITIONS[from].includes(to);
}
