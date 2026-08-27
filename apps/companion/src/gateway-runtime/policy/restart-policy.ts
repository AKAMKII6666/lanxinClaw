/**
 * 自托管 Gateway 崩溃重启策略。
 *
 * 职责：计算指数退避延迟，并判断是否应停止自动拉起（进入 degraded）。
 * 不拥有：子进程 spawn、权限、协议消息。
 * 纯函数：无 I/O。
 */

/** 首次重启延迟毫秒 */
export const DEFAULT_GATEWAY_RESTART_DELAY_MS = 1_000;

/** 重启延迟上限毫秒 */
export const MAX_GATEWAY_RESTART_DELAY_MS = 60_000;

/** 连续自动重启次数上限；超过后进入 degraded，不再拉起 */
export const MAX_GATEWAY_RESTART_ATTEMPTS = 8;

/**
 * 计算下一次自动重启延迟。
 *
 * @param consecutiveFailures 已连续失败次数（含即将进行的这次，从 1 起）
 * @param baseMs 首次延迟
 * @param maxMs 上限
 * @returns 延迟毫秒
 */
export function nextGatewayRestartDelayMs(
  consecutiveFailures: number,
  baseMs = DEFAULT_GATEWAY_RESTART_DELAY_MS,
  maxMs = MAX_GATEWAY_RESTART_DELAY_MS,
): number {
  const n = Math.max(1, consecutiveFailures);
  const delay = baseMs * 2 ** (n - 1);
  return Math.min(maxMs, delay);
}

/**
 * 是否应继续自动重启。
 *
 * @param consecutiveFailures 已连续失败次数
 * @param maxAttempts 上限
 * @returns 未超限则为 true
 */
export function shouldRetryGatewayRestart(
  consecutiveFailures: number,
  maxAttempts = MAX_GATEWAY_RESTART_ATTEMPTS,
): boolean {
  return consecutiveFailures <= maxAttempts;
}
