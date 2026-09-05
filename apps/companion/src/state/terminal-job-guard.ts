/**
 * 父事务终态下的 job 事件门闩。
 *
 * 职责：判断 job 子事件是否允许进入已关闭/已取消 affair。
 * 不拥有：state 写入、状态迁移、UI 投影。
 * 纯函数。
 */

import type { AffairPayload, AffairStatus, JobPayload, ProtocolEnvelope } from "@lanxin-claw/protocol";

type TerminalJobEventDecision =
  | { action: "allow" }
  | { action: "ignore_duplicate" }
  | { action: "reject"; message: string; affairId: string; jobId: string };

export function isTerminalAffairStatus(status: AffairStatus): boolean {
  return status === "closed" || status === "canceled";
}

export function isAllowedJobEventForTerminalAffair(
  envelope: ProtocolEnvelope,
  existing: JobPayload | undefined,
  payload: JobPayload,
): boolean {
  if (payload.status === "canceled" || envelope.type === "job.canceled") {
    return true;
  }
  return Boolean(
    existing &&
      existing.affairId === payload.affairId &&
      existing.status === payload.status &&
      existing.goal === payload.goal,
  );
}

export function decideTerminalAffairJobEvent(
  affair: AffairPayload | undefined,
  envelope: ProtocolEnvelope,
  existing: JobPayload | undefined,
  payload: JobPayload,
): TerminalJobEventDecision {
  if (!affair || !isTerminalAffairStatus(affair.status)) {
    return { action: "allow" };
  }
  if (!isAllowedJobEventForTerminalAffair(envelope, existing, payload)) {
    return {
      action: "reject",
      message: `affair ${affair.affairId} 已是 ${affair.status}，拒绝 ${envelope.type} 推进 job`,
      affairId: affair.affairId,
      jobId: payload.jobId,
    };
  }
  return envelope.type === "job.canceled" || payload.status === "canceled"
    ? { action: "allow" }
    : { action: "ignore_duplicate" };
}
