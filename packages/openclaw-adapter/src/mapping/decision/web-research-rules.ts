/**
 * 查资料旁路：web_search 软失败与可行动失败裁决片段。
 *
 * 职责：产出 failed / soft-search-terminal 裁决字段；由 decide-job 写入完整 decision。
 * 不拥有：完整规则优先级、监督投影、job store。
 * 纯函数：不修改入参。
 */

import type {
  OpenClawEvidenceKind,
  OpenClawEvidenceStrength,
  OpenClawExecutionEvidence,
} from "../../evidence/openclaw-execution-evidence.js";
import type { OpenClawRunStatus } from "../../status/openclaw-run-status.js";
import type { JobStatus } from "@lanxin-claw/protocol";
import {
  failedFindingKind,
  firstActionableFailedFinding,
  hasTerminalLifecycle,
  isSoftWebSearchFinding,
  safeText,
  summaryFromEvidence,
} from "./evidence-helpers.js";

/** 写入完整 decision 的回调（由 decide-job 注入）。 */
export type WriteJobDecision = (
  status: JobStatus,
  input: {
    kind: OpenClawEvidenceKind;
    strength: OpenClawEvidenceStrength;
    reasonCode: string;
    summary: string;
    blockedReason: string | null;
    resumeCondition: string | null;
    rawRunStatus?: string | null;
  },
) => unknown;

/** 规则所需最小上下文。 */
export interface WebResearchRuleContext {
  /** 观测证据 */
  evidence: OpenClawExecutionEvidence;
  /** 归一化 run 状态 */
  rawRunStatus: OpenClawRunStatus | null;
}

/**
 * 可行动工具失败 → failed（跳过 search 旁路与过早 fetch）。
 *
 * @param context 规则上下文
 * @param write 裁决写入
 * @returns 已写入结果或 null
 */
export function evaluateFailedFindingRule(
  context: WebResearchRuleContext,
  write: WriteJobDecision,
): unknown | null {
  const finding = firstActionableFailedFinding(context.evidence, context.rawRunStatus);
  if (!finding) {
    return null;
  }
  const reason = safeText(
    finding.summary ?? finding.errorCode ?? summaryFromEvidence(context.evidence, "OpenClaw 工具执行失败"),
  );
  const toolName = String(finding.toolName ?? "").toLowerCase();
  let reasonCode = finding.status === "timed_out" ? "openclaw.tool_timed_out" : "openclaw.tool_failed";
  if (finding.status !== "timed_out" && (toolName === "web_fetch" || toolName.includes("web_fetch"))) {
    reasonCode = "openclaw.web_fetch_failed";
  }
  return write("failed", {
    kind: failedFindingKind(finding),
    strength: "strong",
    reasonCode,
    summary: reason,
    blockedReason: reason,
    resumeCondition: null,
    rawRunStatus: context.rawRunStatus,
  });
}

/**
 * 终态仅剩 web_search 禁用旁路噪声 → blocked + web_search_disabled。
 *
 * @param context 规则上下文
 * @param write 裁决写入
 * @returns 已写入结果或 null
 */
export function evaluateSoftWebSearchTerminalRule(
  context: WebResearchRuleContext,
  write: WriteJobDecision,
): unknown | null {
  if (!hasTerminalLifecycle(context.evidence) && context.rawRunStatus !== "completed") {
    return null;
  }
  const softOnly = context.evidence.toolFindings.filter(
    (finding) => finding.status === "failed" || finding.status === "blocked" || finding.status === "timed_out",
  );
  if (softOnly.length === 0 || !softOnly.every((finding) => isSoftWebSearchFinding(finding))) {
    return null;
  }
  if (context.evidence.toolFindings.some((finding) => finding.status === "succeeded")) {
    return null;
  }
  const reason = safeText(
    softOnly[0]?.summary ?? "web_search 未启用；请改用托管浏览器完成查资料",
  );
  return write("blocked", {
    kind: "audit.blocked",
    strength: "medium",
    reasonCode: "openclaw.web_search_disabled",
    summary: reason,
    blockedReason: reason,
    resumeCondition: "需要改用托管浏览器（desktop.control）或确认其他执行方式",
    rawRunStatus: context.rawRunStatus,
  });
}
