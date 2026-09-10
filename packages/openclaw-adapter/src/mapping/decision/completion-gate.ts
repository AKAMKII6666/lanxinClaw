/**
 * OpenClaw 完成证据门闩。
 *
 * 职责：判断终态是否具备可验收业务文本，堵住空壳 completed。
 * 不拥有：状态裁决优先级、监督投影、runtime I/O。
 * 纯函数：不修改入参。
 */

import { permissionInferenceText } from "@lanxin-claw/protocol";
import type { OpenClawExecutionEvidence } from "../../evidence/openclaw-execution-evidence.js";
import type { AdapterJobRecord } from "../../jobs/job-types.js";
import {
  classifyBusinessEvidence,
  classifyTextBusinessSignal,
  hasNegativeFinalReply,
  isLowSignalText,
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
 * 与投影共用 classifyBusinessEvidence：present 一律可完成；
 * weak 仅在不要求结构化证据的低风险任务上可完成。
 *
 * @param context 完成门闩上下文
 * @returns 可写 completed 时为 true
 */
export function hasBusinessCompletionEvidence(context: CompletionGateContext): boolean {
  const classified = classifyBusinessEvidence(context.evidence, { goal: context.job.goal });
  if (classified.quality === "present") {
    return true;
  }
  if (classified.quality === "weak" && !requiresStructuredCompletionEvidence(context)) {
    return true;
  }
  if (context.taskOutcome === "completed" && hasMeaningfulTaskResult(context.evidence, context.job.goal)) {
    return true;
  }
  if (hasMeaningfulToolCompletionEvidence(context)) {
    return true;
  }
  return false;
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
    const classified = classifyTextBusinessSignal(summary, context.job.goal);
    return classified.quality === "present" && !isProcessOnlyToolSummary(summary, finding.toolName);
  });
}

/**
 * 高风险权限或联网目标要求结构化完成证据（必须 present，weak 不够）。
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
  const goal = permissionInferenceText(context.job.goal);
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
  return classifyTextBusinessSignal(text).quality !== "present";
}

/**
 * task ledger 是否有 present 结果摘要。
 *
 * @param evidence OpenClaw 观测证据
 * @param goal 任务目标
 * @returns 有 present task 结果时为 true
 */
function hasMeaningfulTaskResult(evidence: OpenClawExecutionEvidence, goal?: string | null): boolean {
  return (
    classifyTextBusinessSignal(evidence.task?.terminalSummary, goal).quality === "present" ||
    classifyTextBusinessSignal(evidence.task?.progressSummary, goal).quality === "present"
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
 * task 结果是否 present，供 completed 证据类别选择。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 有 present task 结果时为 true
 */
export function hasMeaningfulTaskCompletion(evidence: OpenClawExecutionEvidence): boolean {
  return hasMeaningfulTaskResult(evidence);
}

/**
 * 终态成功但尚不足以 completed 时，可纠为 terminal_without_result。
 * present / 低风险 weak 由 hasBusinessCompletionEvidence 放行；其余（missing、高风险 weak）走本门闩。
 *
 * @param context 完成门闩上下文
 * @returns 应纠为无结果阻塞时为 true
 */
export function isTerminalWithoutBusinessResult(context: CompletionGateContext): boolean {
  if (hasNegativeFinalReply(context.evidence) || hasNegativeToolFinding(context.evidence)) {
    return false;
  }
  return !hasBusinessCompletionEvidence(context);
}
