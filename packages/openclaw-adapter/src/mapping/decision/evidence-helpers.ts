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
import { isLowSignalText, pickMeaningfulBusinessText } from "./business/business-evidence.js";
import { safeText } from "./business/safe-text.js";

export {
classifyBusinessEvidence,
classifyTextBusinessSignal,
hasBusinessEntitySignal,
isLowSignalText,
isMeaningfulCompletionText,
isUsableProgressText,
pickMeaningfulBusinessText
} from "./business/business-evidence.js";
export type {
BusinessEvidenceClassification,
BusinessEvidenceKind,
BusinessEvidenceQuality,
ClassifyBusinessEvidenceOptions
} from "./business/business-evidence.js";
export { safeText } from "./business/safe-text.js";
export { hasTerminalLifecycle, normalizeEvidenceRunStatus } from "./status/run.js";

/** task ledger 的粗分类。 */
export type TaskOutcome = "running" | "blocked" | "failed" | "completed" | null;

/** 需要用户或策略介入的文本线索。 */
const BLOCKING_TEXT_PATTERN =
  /(policy|permission|approval|not allowed|denied|blocked|disabled|no provider|unavailable|not configured|missing provider|cannot|can't|unable|requires user|need user|unauthorized|forbidden|受限|阻止|阻塞|权限|授权|不可用|未配置|不允许|无法|不能|需要用户|需要你|拒绝)/i;

/** 失败/未完成的最终回复线索。 */
const NEGATIVE_FINAL_REPLY_PATTERN =
  /(cannot complete|can't complete|unable to complete|could not complete|not completed|failed to|blocked by|policy (blocked|block|restriction|restricted|denied|forbidden|not allowed)|permission (required|needed|denied|missing|blocked|not granted)|requires (user )?(permission|approval)|needs (user )?(permission|approval)|without permission|no permission|disabled|no provider|unavailable|not configured|无法完成|无法|不能|没能完成|没有完成|执行失败|受限|策略限制|被阻止|不可用|未配置|需要你|需要用户|没有权限|缺少权限)/i;

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
    if (isSoftWebSearchFinding(finding)) {
      continue;
    }
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
 * 是否为可忽略的 web_search 旁路失败（产品默认禁用 search）。
 *
 * @param finding 工具证据
 * @returns 是则 true
 */
export function isSoftWebSearchFinding(finding: OpenClawToolFinding): boolean {
  const name = String(finding.toolName ?? "").toLowerCase();
  if (name !== "web_search" && !name.includes("web_search")) {
    return false;
  }
  if (finding.status !== "failed" && finding.status !== "blocked" && finding.status !== "unknown") {
    return false;
  }
  const text = `${finding.summary ?? ""} ${finding.errorCode ?? ""}`;
  return (
    /disabled|no provider|not configured|unavailable|未启用|不可用|未配置/i.test(text) ||
    text.trim().length === 0
  );
}

/**
 * 证据中是否已有 browser 工具尝试。
 *
 * @param evidence 观测证据
 * @returns 是则 true
 */
export function hasBrowserToolFinding(evidence: OpenClawExecutionEvidence): boolean {
  return evidence.toolFindings.some((finding) => {
    const name = String(finding.toolName ?? "").toLowerCase();
    return name === "browser" || name.startsWith("browser.") || name.includes("browser");
  });
}

/**
 * 是否为 run 未终态、且尚无 browser 尝试时的过早 web_fetch 失败。
 *
 * @param finding 工具证据
 * @param evidence 全量证据
 * @param rawRunStatus 归一化 run 状态
 * @returns 应推迟终态则 true
 */
export function isPrematureWebFetchFailure(
  finding: OpenClawToolFinding,
  evidence: OpenClawExecutionEvidence,
  rawRunStatus: string | null | undefined,
): boolean {
  const name = String(finding.toolName ?? "").toLowerCase();
  if (name !== "web_fetch" && !name.includes("web_fetch")) {
    return false;
  }
  if (finding.status !== "failed") {
    return false;
  }
  if (hasBrowserToolFinding(evidence)) {
    return false;
  }
  if (hasTerminalLifecycle(evidence)) {
    return false;
  }
  const status = String(rawRunStatus ?? "");
  if (status === "completed" || status === "failed" || status === "cancelled" || status === "timed_out") {
    return false;
  }
  return true;
}

/**
 * 读取第一条应推动终态的失败证据（跳过 search 旁路与过早 fetch）。
 *
 * @param evidence 观测证据
 * @param rawRunStatus 归一化状态
 * @returns 失败证据或 null
 */
export function firstActionableFailedFinding(
  evidence: OpenClawExecutionEvidence,
  rawRunStatus?: string | null,
): OpenClawToolFinding | null {
  for (const finding of evidence.toolFindings) {
    if (finding.status !== "failed" && finding.status !== "timed_out") {
      continue;
    }
    if (isSoftWebSearchFinding(finding)) {
      continue;
    }
    if (isPrematureWebFetchFailure(finding, evidence, rawRunStatus)) {
      continue;
    }
    return finding;
  }
  return null;
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
 * @param fallback 无摘要时的兜底文案；若也是低信号则改用人话默认句
 * @returns 已脱敏的摘要；禁止单独广播纯状态词
 */
export function summaryFromEvidence(evidence: OpenClawExecutionEvidence, fallback: string): string {
  const picked = pickMeaningfulBusinessText(evidence, null);
  if (picked) {
    return picked;
  }
  const safeFallback = safeText(fallback);
  if (safeFallback && !isLowSignalText(safeFallback)) {
    return safeFallback;
  }
  return "OpenClaw 正在执行";
}

import { hasTerminalLifecycle } from "./status/run.js";
