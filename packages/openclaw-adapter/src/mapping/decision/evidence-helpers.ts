/**
 * OpenClaw 状态裁决证据辅助。
 *
 * 职责：把多源证据中的状态、文本和终态线索读成裁决规则可用的小事实。
 * 不拥有：规则优先级、job 状态写入、runtime I/O。
 * 纯函数：不修改入参。
 */

import type {
  OpenClawEvidenceKind,
  OpenClawExecutionEvidence,
  OpenClawToolFinding,
} from "../../evidence/openclaw-execution-evidence.js";
import type { OpenClawRunStatus } from "../../status/openclaw-run-status.js";

/** task ledger 的粗分类。 */
export type TaskOutcome = "running" | "blocked" | "failed" | "completed" | null;

/** 需要用户或策略介入的文本线索。 */
const BLOCKING_TEXT_PATTERN =
  /(policy|permission|approval|not allowed|denied|blocked|cannot|can't|unable|requires user|need user|unauthorized|forbidden|受限|阻止|阻塞|权限|授权|不允许|无法|不能|需要用户|需要你|拒绝)/i;

/** 失败/未完成的最终回复线索。 */
const NEGATIVE_FINAL_REPLY_PATTERN =
  /(cannot complete|can't complete|unable to complete|could not complete|not completed|failed to|blocked by|policy|permission|无法完成|无法|不能|没能完成|没有完成|执行失败|受限|策略限制|被阻止|需要你|需要用户|没有权限|缺少权限)/i;

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
 * 判断 tool/task 证据是否显示取消。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 是否存在取消线索
 */
export function hasCancelledFinding(evidence: OpenClawExecutionEvidence): boolean {
  if (evidence.toolFindings.some((finding) => finding.status === "cancelled")) {
    return true;
  }
  const taskStatus = `${evidence.task?.status ?? ""} ${evidence.task?.terminalOutcome ?? ""}`.toLowerCase();
  return /cancelled|canceled|aborted/.test(taskStatus);
}

/**
 * 读取第一条阻塞类 tool/audit 证据。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 阻塞证据；不存在时为 null
 */
export function firstBlockingFinding(evidence: OpenClawExecutionEvidence): OpenClawToolFinding | null {
  for (const finding of evidence.toolFindings) {
    if (finding.status === "blocked") {
      return finding;
    }
    if (
      (finding.status === "failed" || finding.status === "unknown") &&
      (containsBlockingText(finding.errorCode) || containsBlockingText(finding.summary))
    ) {
      return finding;
    }
  }
  return null;
}

/**
 * 读取第一条失败类 tool/audit 证据。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 失败证据；不存在时为 null
 */
export function firstFailedFinding(evidence: OpenClawExecutionEvidence): OpenClawToolFinding | null {
  return (
    evidence.toolFindings.find(
      (finding) => finding.status === "failed" || finding.status === "timed_out",
    ) ?? null
  );
}

/**
 * 判断阻塞证据的主来源类别。
 *
 * @param finding tool/audit 证据
 * @returns 裁决证据类别
 */
export function blockingFindingKind(finding: OpenClawToolFinding): OpenClawEvidenceKind {
  return finding.toolName || finding.toolCallId ? "audit.blocked" : "wait.failed";
}

/**
 * 判断失败证据的主来源类别。
 *
 * @param finding tool/audit 证据
 * @returns 裁决证据类别
 */
export function failedFindingKind(finding: OpenClawToolFinding): OpenClawEvidenceKind {
  return finding.toolName || finding.toolCallId ? "audit.failed" : "wait.failed";
}

/**
 * 粗分类 OpenClaw task ledger。
 *
 * @param evidence OpenClaw 观测证据
 * @returns task 结果分类；无 task 线索时为 null
 */
export function classifyTask(evidence: OpenClawExecutionEvidence): TaskOutcome {
  const text = [
    evidence.task?.status,
    evidence.task?.terminalOutcome,
    evidence.task?.error,
    evidence.task?.terminalSummary,
  ]
    .filter(Boolean)
    .join(" ");
  const lower = text.toLowerCase();
  if (!lower.trim()) {
    return null;
  }
  if (containsBlockingText(text)) {
    return "blocked";
  }
  if (/timed_out|timeout|failed|failure|error|errored/.test(lower)) {
    return "failed";
  }
  if (/completed|complete|done|success|succeeded|ok/.test(lower)) {
    return "completed";
  }
  if (/running|pending|queued|active|in_progress/.test(lower)) {
    return "running";
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

/**
 * 判断 wait ok 是否同时有终态证据支撑。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 是否可视为完成
 */
export function isWaitOkWithTerminalEvidence(evidence: OpenClawExecutionEvidence): boolean {
  const status = evidence.wait?.status?.trim().toLowerCase();
  return (status === "ok" || status === "completed" || status === "complete") && hasTerminalLifecycle(evidence);
}

/**
 * 判断 wait 响应是否为错误状态。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 是否为 wait error/failure
 */
export function isWaitError(evidence: OpenClawExecutionEvidence): boolean {
  const status = evidence.wait?.status?.trim().toLowerCase();
  return status === "error" || status === "failed" || status === "failure";
}

/**
 * 判断 lifecycle 是否显示错误终态。
 *
 * @param evidence OpenClaw 观测证据
 * @returns true 表示 lifecycle 已明确失败
 */
export function isLifecycleError(evidence: OpenClawExecutionEvidence): boolean {
  const phase = evidence.lifecycle?.terminalPhase?.trim().toLowerCase();
  return phase === "error" || phase === "failed" || phase === "failure";
}

/**
 * 判断 timeout 是否只是本次 wait 探针超时。
 *
 * @param evidence OpenClaw 观测证据
 * @returns true 表示继续观察而非终态失败
 */
export function isWaitOnlyTimeout(evidence: OpenClawExecutionEvidence): boolean {
  const status = evidence.wait?.status?.trim().toLowerCase();
  if (status !== "timeout") {
    return false;
  }
  return !hasTerminalLifecycle(evidence) && !isTerminalTimeout(evidence);
}

/**
 * 判断 timeout 是否已有终态证据。
 *
 * @param evidence OpenClaw 观测证据
 * @returns true 表示可裁决为终态超时
 */
export function isTerminalTimeout(evidence: OpenClawExecutionEvidence): boolean {
  const waitPhase = evidence.wait?.timeoutPhase?.trim().toLowerCase();
  const lifecyclePhase = evidence.lifecycle?.terminalPhase?.trim().toLowerCase();
  const lifecycleReason = evidence.lifecycle?.terminalReason?.trim().toLowerCase();
  return (
    waitPhase === "terminal" ||
    lifecyclePhase === "timeout" ||
    lifecycleReason === "timeout" ||
    evidence.task?.terminalOutcome?.trim().toLowerCase() === "timeout"
  );
}

/**
 * 判断最终回复是否表达目标未完成。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 是否命中失败/阻塞语义
 */
export function hasNegativeFinalReply(evidence: OpenClawExecutionEvidence): boolean {
  return NEGATIVE_FINAL_REPLY_PATTERN.test(evidence.finalReply?.text ?? "");
}

/**
 * 判断文本是否包含策略、权限或用户介入线索。
 *
 * @param value 待检查文本
 * @returns 是否包含阻塞线索
 */
export function containsBlockingText(value: string | null | undefined): boolean {
  return Boolean(value && BLOCKING_TEXT_PATTERN.test(value));
}

/**
 * 从证据中提取恢复条件。
 *
 * @param evidence OpenClaw 观测证据
 * @param fallback 无明确条件时的兜底文案
 * @returns 已脱敏的恢复条件
 */
export function resumeConditionFromEvidence(evidence: OpenClawExecutionEvidence, fallback: string): string {
  return safeText(evidence.wait?.stopReason ?? evidence.lifecycle?.terminalReason ?? fallback);
}

/**
 * 从证据中提取用户可见摘要。
 *
 * @param evidence OpenClaw 观测证据
 * @param fallback 无摘要时的兜底文案
 * @returns 已脱敏的摘要
 */
export function summaryFromEvidence(evidence: OpenClawExecutionEvidence, fallback: string): string {
  const tool = [...evidence.toolFindings].reverse().find((finding) => finding.summary || finding.errorCode);
  return safeText(
    tool?.summary ??
      tool?.errorCode ??
      evidence.task?.terminalSummary ??
      evidence.task?.progressSummary ??
      evidence.task?.error ??
      evidence.finalReply?.text ??
      evidence.wait?.error ??
      evidence.lifecycle?.terminalReason ??
      fallback,
  );
}

/**
 * 清理用户可见文本。
 *
 * @param value 原始文本
 * @returns 压缩空白并脱敏后的文本
 */
export function safeText(value: string | null | undefined): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer ***")
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .slice(0, 800);
}
