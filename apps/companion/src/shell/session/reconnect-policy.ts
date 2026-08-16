/**
 * 会话自动重连与断线提示策略。
 *
 * 职责：计算重连退避、是否应提示用户、托盘/UI 文案。
 * 不拥有：WebSocket 实现、pairing 权威、权限。
 * 纯函数：无 I/O。
 */

/**
 * 重连策略参数。
 */
export interface ReconnectPolicy {
  /** 最大尝试次数；超出停止自动重连 */
  maxAttempts: number;
  /** 基础间隔 ms */
  baseDelayMs: number;
  /** 最大间隔 ms */
  maxDelayMs: number;
}

/** 默认策略：低打扰指数退避 */
export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  maxAttempts: 8,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/**
 * 计算第 N 次尝试前的等待（0-based attemptIndex）。
 *
 * @param policy 策略
 * @param attemptIndex 第几次（从 0）
 * @returns 延迟 ms；若应停止返回 null
 */
export function nextReconnectDelayMs(
  policy: ReconnectPolicy,
  attemptIndex: number,
): number | null {
  if (attemptIndex < 0 || attemptIndex >= policy.maxAttempts) {
    return null;
  }
  const raw = policy.baseDelayMs * 2 ** attemptIndex;
  return Math.min(raw, policy.maxDelayMs);
}

/**
 * 断线提示文案。
 *
 * @param phase 阶段
 * @param attemptIndex 当前尝试序号；停止时可为 maxAttempts
 * @returns 用户可见中文
 */
export function disconnectHintCopy(
  phase: "disconnected" | "reconnecting" | "gave_up" | "restored",
  attemptIndex = 0,
): string {
  if (phase === "disconnected") {
    return "与澜星电话的连接已断开。";
  }
  if (phase === "reconnecting") {
    return `正在尝试重连（第 ${attemptIndex + 1} 次）…`;
  }
  if (phase === "gave_up") {
    return "自动重连已停止。请检查局域网与配对，或在控制面板手动重连。";
  }
  return "连接已恢复。";
}

/**
 * 托盘 tooltip：连接态摘要。
 *
 * @param connected 是否已连接
 * @param reconnecting 是否重连中
 * @returns tooltip
 */
export function trayConnectionToolTip(connected: boolean, reconnecting: boolean): string {
  if (connected) {
    return "澜星 Claw · 已连接";
  }
  if (reconnecting) {
    return "澜星 Claw · 重连中";
  }
  return "澜星 Claw · 已断线";
}
