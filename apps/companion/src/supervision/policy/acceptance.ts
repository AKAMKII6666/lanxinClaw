/**
 * 事务验收策略纯函数。
 *
 * 职责：根据 worker 完成与用户决策推导 affair 下一态；禁止 completed→closed。
 * 不拥有：协议发送、UI、OpenClaw、权限。
 * 纯函数：无 I/O。
 */

/** 验收相关事务态 */
export type AcceptanceAffairStatus =
  | "running"
  | "delegated"
  | "blocked"
  | "paused"
  | "waiting_acceptance"
  | "closed"
  | "canceled";

/** worker 完成类态 */
export type AcceptanceJobStatus = "completed" | "failed" | "canceled" | "running" | "blocked";

/**
 * worker 完成后应进入的事务态。
 *
 * @param jobStatus worker 态
 * @returns waiting_acceptance；非 completed 返回 null
 */
export function affairStatusAfterJobTerminal(
  jobStatus: AcceptanceJobStatus,
): "waiting_acceptance" | null {
  if (jobStatus === "completed") {
    return "waiting_acceptance";
  }
  return null;
}

/**
 * 用户验收决策后的事务态。
 *
 * @param current 当前事务态
 * @param decision 接受或取消
 * @returns 下一态；非法则 null
 */
export function affairStatusAfterUserAcceptance(
  current: AcceptanceAffairStatus,
  decision: "accept" | "cancel",
): AcceptanceAffairStatus | null {
  if (current !== "waiting_acceptance") {
    return null;
  }
  return decision === "accept" ? "closed" : "canceled";
}

/**
 * 验收提示文案。
 *
 * @param phase 阶段
 * @returns 用户可见中文
 */
export function acceptanceCopy(
  phase: "waiting" | "accepted" | "canceled",
): string {
  if (phase === "waiting") {
    return "Claw 说这轮活干完了。请你确认是否达到完成标准；确认后我才把事务关掉。";
  }
  if (phase === "accepted") {
    return "你已确认验收，事务关闭。";
  }
  return "你选择不按完成关闭；事务已取消，不会假装已经验收通过。";
}

/**
 * 硬校验：禁止把 worker completed 当成 affair closed。
 *
 * @param affairStatus 事务态
 * @param jobStatus worker 态
 * @returns 若违规返回错误文案；否则 null
 */
export function detectIllegalAutoClose(
  affairStatus: AcceptanceAffairStatus,
  jobStatus: AcceptanceJobStatus,
): string | null {
  if (jobStatus === "completed" && affairStatus === "closed") {
    return "违规：worker completed 不得自动映射为 affair closed";
  }
  return null;
}
