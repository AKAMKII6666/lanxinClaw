/**
 * OpenClaw run 状态枚举（adapter 侧窄契约）。
 *
 * 职责：描述 runtime client 回报的 run 生命周期，供映射到 Lanxing JobStatus。
 * 不拥有：Gateway RPC 细节、affair 关闭、companion 权限裁决。
 * 纯函数：仅类型与常量，无 I/O。
 */

/** OpenClaw run 在 adapter 边界上的规范化状态 */
export const OPENCLAW_RUN_STATUSES = [
  "accepted",
  "running",
  "waiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

/** OpenClaw run 状态 */
export type OpenClawRunStatus = (typeof OPENCLAW_RUN_STATUSES)[number];

/**
 * 判断值是否为合法 OpenClawRunStatus。
 *
 * @param value 待检测值
 * @returns 是否属于 OPENCLAW_RUN_STATUSES
 */
export function isOpenClawRunStatus(value: unknown): value is OpenClawRunStatus {
  return typeof value === "string" && (OPENCLAW_RUN_STATUSES as readonly string[]).includes(value);
}
