/**
 * OpenClaw 完成证据门闩。
 *
 * 职责：判断终态是否具备可验收业务文本，堵住空壳 completed。
 * 不拥有：状态裁决优先级、监督投影、runtime I/O。
 * 纯函数：不修改入参。
 */

import type { OpenClawExecutionEvidence } from "../../evidence/openclaw-execution-evidence.js";
import type { AdapterJobRecord } from "../../jobs/job-types.js";
import {
  hasBusinessEntitySignal,
  hasNegativeFinalReply,
  isLowSignalText,
  isMeaningfulCompletionText,
  safeText,
  type TaskOutcome,
} from "./evidence-helpers.js";

/** 完成门闩所需的最小上下文。 */
export interface CompletionGateContext {
  /** 当前 adapter job。 */
  job: AdapterJobRecord;
  /** OpenClaw 观测证据。 */
  evidence: OpenClawExecutionEvidence;
  /** task ledger 粗分类。 */
  taskOutcome: TaskOutcome;
}

/**
 * 判断是否具备可验收的业务完成证据。
 *
 * @param context 完成门闩上下文
 * @returns 可写 completed 时为 true
 */
export function hasBusinessCompletionEvidence(context: CompletionGateContext): boolean {
  const { evidence, taskOutcome } = context;
  if (taskOutcome === "completed" && hasMeaningfulTaskResult(evidence)) {
    return true;
  }
  if (hasMeaningfulToolCompletionEvidence(context)) {
    return true;
  }
  if (requiresStructuredCompletionEvidence(context)) {
    return false;
  }
  return hasMeaningfulFinalReply(evidence);
}

/**
 * 判断是否存在 meaningful 且非过程型的成功工具证据。
 *
 * @param context 完成门闩上下文
 * @returns 存在可验收工具结果时为 true
 */
function hasMeaningfulToolCompletionEvidence(context: CompletionGateContext): boolean {
  const succeeded = context.evidence.toolFindings.filter((finding) => finding.status === "succeeded");
  if (succeeded.length === 0) {
    return false;
  }
  return succeeded.some((finding) => {
    const summary = safeText(finding.summary ?? "");
    return isMeaningfulCompletionText(summary) && !isProcessOnlyToolSummary(summary, finding.toolName);
  });
}

/**
 * 高风险权限或联网目标要求结构化完成证据。
 *
 * @param context 完成门闩上下文
 * @returns 需要结构化证据时为 true
 */
function requiresStructuredCompletionEvidence(context: CompletionGateContext): boolean {
  const permissions = new Set(context.job.allowedPermissions);
  if (
    permissions.has("workspace.write") ||
    permissions.has("command.run") ||
    permissions.has("network.access") ||
    permissions.has("desktop.control") ||
    permissions.has("git.write")
  ) {
    return true;
  }
  const goal = safeText(context.job.goal);
  return /(browser|web|http|https|url|news|search|浏览器|网页|网址|新闻|搜索|联网)/i.test(goal);
}

/**
 * 过程型工具摘要（打开浏览器、空白页等）不算业务完成。
 *
 * @param summary 工具摘要
 * @param toolName 工具名
 * @returns 仅过程信号时为 true
 */
function isProcessOnlyToolSummary(summary: string, toolName?: string): boolean {
  const text = safeText(`${toolName ?? ""} ${summary}`);
  if (!text || isLowSignalText(summary)) {
    return true;
  }
  // 无业务实体的工具摘要一律视为过程型，避免 opened/ready/listing 空壳完成。
  return !hasBusinessEntitySignal(text);
}

/**
 * 最终回复是否可作为完成证据。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 可作为完成证据时为 true
 */
function hasMeaningfulFinalReply(evidence: OpenClawExecutionEvidence): boolean {
  if (hasNegativeFinalReply(evidence)) {
    return false;
  }
  return isMeaningfulCompletionText(evidence.finalReply?.text);
}

/**
 * task ledger 是否有 meaningful 结果摘要。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 有 meaningful task 结果时为 true
 */
function hasMeaningfulTaskResult(evidence: OpenClawExecutionEvidence): boolean {
  return (
    isMeaningfulCompletionText(evidence.task?.terminalSummary) ||
    isMeaningfulCompletionText(evidence.task?.progressSummary)
  );
}

/**
 * 是否存在负面 tool finding。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 存在失败/阻塞/超时/取消工具时为 true
 */
export function hasNegativeToolFinding(evidence: OpenClawExecutionEvidence): boolean {
  return evidence.toolFindings.some(
    (finding) =>
      finding.status === "failed" ||
      finding.status === "blocked" ||
      finding.status === "timed_out" ||
      finding.status === "cancelled",
  );
}

/**
 * task 结果是否 meaningful，供 completed 证据类别选择。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 有 meaningful task 结果时为 true
 */
export function hasMeaningfulTaskCompletion(evidence: OpenClawExecutionEvidence): boolean {
  return hasMeaningfulTaskResult(evidence);
}
