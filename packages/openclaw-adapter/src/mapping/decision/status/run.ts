/** 职责：归一化原始运行状态和终态信号。不拥有：最终裁决优先级。纯函数，无 I/O。 */
import type {
OpenClawExecutionEvidence
} from "../../../evidence/openclaw-execution-evidence.js";
import type { OpenClawRunStatus } from "../../../status/openclaw-run-status.js";


/**
 * 归一化 evidence 中的 OpenClaw run 状态。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 规范状态；证据不足时返回 null
 */
export function normalizeEvidenceRunStatus(evidence: OpenClawExecutionEvidence): OpenClawRunStatus | null {
  const candidates = [
    evidence.wait?.status,
    evidence.task?.terminalOutcome,
    evidence.task?.status,
    ...(evidence.sourceStatuses ?? []),
  ];
  for (const value of candidates) {
    const normalized = normalizeRunStatus(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizeRunStatus(value: string | undefined): OpenClawRunStatus | null {
  const lower = value?.trim().toLowerCase();
  if (!lower) {
    return null;
  }
  if (["accepted", "queued", "created", "pending", "in_flight"].includes(lower)) {
    return "accepted";
  }
  if (["running", "in_progress", "active", "working"].includes(lower)) {
    return "running";
  }
  if (["approval_required", "approval.request", "waiting_approval", "needs_permission"].includes(lower)) {
    return "waiting_approval";
  }
  if (["blocked", "requires_user", "need_user", "requires_input"].includes(lower)) {
    return "blocked";
  }
  if (["completed", "complete", "done", "success", "succeeded"].includes(lower)) {
    return "completed";
  }
  if (["failed", "failure", "error", "errored"].includes(lower)) {
    return "failed";
  }
  if (["cancelled", "canceled", "aborted", "abort"].includes(lower)) {
    return "cancelled";
  }
  if (["timed_out", "terminal_timeout"].includes(lower)) {
    return "timed_out";
  }
  return null;
}

/**
 * 判断 evidence 是否携带终态 lifecycle。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 是否存在 run 终态证据
 */
export function hasTerminalLifecycle(evidence: OpenClawExecutionEvidence): boolean {
  const status = normalizeEvidenceRunStatus(evidence);
  return Boolean(
    evidence.lifecycle?.endedAt ||
      evidence.lifecycle?.terminalPhase ||
      evidence.wait?.endedAt ||
      status === "completed" ||
      status === "failed" ||
      status === "timed_out" ||
      status === "cancelled",
  );
}
