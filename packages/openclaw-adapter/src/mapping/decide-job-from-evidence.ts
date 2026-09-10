/**
 * OpenClaw 证据 → Lanxin job 状态裁决。
 *
 * 职责：把 wait/audit/task/history 等观测证据合并为一个可解释的 job decision。
 * 不拥有：runtime I/O、job store 写入、affair 关闭、phone 协议发送。
 * 纯函数：不修改入参。
 */

import type {
OpenClawExecutionEvidence
} from "../evidence/openclaw-execution-evidence.js";
import type { AdapterJobRecord } from "../jobs/job-types.js";
import {
hasBusinessCompletionEvidence,
hasMeaningfulTaskCompletion,
hasNegativeToolFinding,
isTerminalWithoutBusinessResult,
} from "./decision/completion-gate.js";
import {
blockingFindingKind,
classifyBusinessEvidence,
classifyTask,
containsBlockingText,
firstBlockingFinding,
hasCancelledFinding,
hasNegativeFinalReply,
hasTerminalLifecycle,
isLifecycleError,
isTerminalTimeout,
isWaitError,
isWaitOkWithTerminalEvidence,
isWaitOnlyTimeout,
normalizeEvidenceRunStatus,
pickMeaningfulBusinessText,
resumeConditionFromEvidence,
safeText,
summaryFromEvidence
} from "./decision/evidence-helpers.js";
import {
evaluateFailedFindingRule,
evaluateSoftWebSearchTerminalRule,
} from "./decision/web-research-rules.js";

const DECISION_RULES: readonly DecisionRule[] = [
  terminalJobRule,
  cancellationRule,
  blockingFindingRule,
  waitingApprovalRule,
  negativeFinalReplyRule,
  failedFindingRule,
  softWebSearchTerminalRule,
  taskBlockedRule,
  taskFailedRule,
  runFailedRule,
  lifecycleFailedRule,
  terminalTimeoutRule,
  terminalWithoutResultRule,
  completedRule,
  acceptedRule,
  waitOnlyTimeoutRule,
];

/**
 * 根据证据裁决 Lanxin job 状态。
 *
 * @param job 当前 adapter job
 * @param evidence OpenClaw 观测证据
 * @returns 状态裁决
 */
export function decideJobFromEvidence(
  job: AdapterJobRecord,
  evidence: OpenClawExecutionEvidence,
): OpenClawToLanxinJobDecision {
  const context: DecisionContext = {
    job,
    evidence,
    rawRunStatus: normalizeEvidenceRunStatus(evidence),
    taskOutcome: classifyTask(evidence),
  };
  return firstRuleDecision(context) ?? runningDecision(context);
}

function firstRuleDecision(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  for (const rule of DECISION_RULES) {
    const result = rule(context);
    if (result) {
      return result;
    }
  }
  return null;
}

function cancellationRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const { evidence, rawRunStatus } = context;
  if (!evidence.localCancelAck && rawRunStatus !== "cancelled" && !hasCancelledFinding(evidence)) {
    return null;
  }
  return decide(context, "canceled", {
    kind: "local.cancel_ack",
    strength: "strong",
    reasonCode: "openclaw.cancel_ack",
    summary: summaryFromEvidence(evidence, "OpenClaw 已确认取消"),
    blockedReason: null,
    resumeCondition: null,
    rawRunStatus,
  });
}

function blockingFindingRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const finding = firstBlockingFinding(context.evidence);
  if (!finding) {
    return null;
  }
  const reason = safeText(
    finding.summary ?? finding.errorCode ?? summaryFromEvidence(context.evidence, "OpenClaw 执行被阻塞"),
  );
  return decide(context, "blocked", {
    kind: blockingFindingKind(finding),
    strength: "strong",
    reasonCode: "openclaw.blocked_by_tool_or_policy",
    summary: reason,
    blockedReason: reason,
    resumeCondition: resumeConditionFromEvidence(context.evidence, "需要用户确认限制、补充权限或调整执行方式"),
    rawRunStatus: context.rawRunStatus,
  });
}

function waitingApprovalRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (context.rawRunStatus !== "waiting_approval") {
    return null;
  }
  return decide(context, "needs_permission", {
    kind: "wait.waiting_approval",
    strength: "medium",
    reasonCode: "openclaw.waiting_approval",
    summary: summaryFromEvidence(context.evidence, "OpenClaw 正在等待授权"),
    blockedReason: null,
    resumeCondition: resumeConditionFromEvidence(context.evidence, "需要用户完成授权后继续"),
    rawRunStatus: context.rawRunStatus,
  });
}

function negativeFinalReplyRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const { evidence } = context;
  if (!hasTerminalLifecycle(evidence) || !hasNegativeFinalReply(evidence)) {
    return null;
  }
  const reason = safeText(evidence.finalReply?.text ?? "OpenClaw 结束但最终回复显示目标未完成");
  return decide(context, "blocked", {
    kind: "history.negative_final_reply",
    strength: evidence.finalReply?.confidence === "medium" ? "medium" : "weak",
    reasonCode: "openclaw.final_reply_negative",
    summary: reason,
    blockedReason: reason,
    resumeCondition: "需要张老板向用户说明限制，并确认下一步处理方式",
    rawRunStatus: context.rawRunStatus,
  });
}

function failedFindingRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  return evaluateFailedFindingRule(context, (status, input) => decide(context, status, input)) as
    | OpenClawToLanxinJobDecision
    | null;
}

function softWebSearchTerminalRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  return evaluateSoftWebSearchTerminalRule(context, (status, input) =>
    decide(context, status, input),
  ) as OpenClawToLanxinJobDecision | null;
}

function taskBlockedRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (context.taskOutcome !== "blocked") {
    return null;
  }
  const reason = summaryFromEvidence(context.evidence, "OpenClaw task ledger 显示任务被阻塞");
  return decide(context, "blocked", {
    kind: "task.blocked",
    strength: "medium",
    reasonCode: "openclaw.task_blocked",
    summary: reason,
    blockedReason: reason,
    resumeCondition: resumeConditionFromEvidence(context.evidence, "需要用户确认后继续"),
    rawRunStatus: context.rawRunStatus,
  });
}

function taskFailedRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (context.taskOutcome !== "failed") {
    return null;
  }
  const reason = summaryFromEvidence(context.evidence, "OpenClaw task ledger 显示任务失败");
  return decide(context, "failed", {
    kind: "task.failed",
    strength: "medium",
    reasonCode: "openclaw.task_failed",
    summary: reason,
    blockedReason: reason,
    resumeCondition: null,
    rawRunStatus: context.rawRunStatus,
  });
}

function runFailedRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const { evidence, rawRunStatus } = context;
  if (rawRunStatus !== "failed" && !isWaitError(evidence)) {
    return null;
  }
  const reason = summaryFromEvidence(evidence, "OpenClaw run 执行失败");
  const isBlocked = containsBlockingText(reason) || containsBlockingText(evidence.wait?.error);
  return decide(context, isBlocked ? "blocked" : "failed", {
    kind: "wait.failed",
    strength: "medium",
    reasonCode: isBlocked ? "openclaw.run_blocked" : "openclaw.run_failed",
    summary: reason,
    blockedReason: reason,
    resumeCondition: isBlocked ? "需要用户确认限制、补充权限或调整执行方式" : null,
    rawRunStatus,
  });
}

function lifecycleFailedRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (!isLifecycleError(context.evidence)) {
    return null;
  }
  const reason = summaryFromEvidence(context.evidence, "OpenClaw lifecycle 显示执行失败");
  const isBlocked = containsBlockingText(reason) || containsBlockingText(context.evidence.lifecycle?.terminalReason);
  return decide(context, isBlocked ? "blocked" : "failed", {
    kind: "audit.failed",
    strength: "medium",
    reasonCode: isBlocked ? "openclaw.lifecycle_blocked" : "openclaw.lifecycle_failed",
    summary: reason,
    blockedReason: reason,
    resumeCondition: isBlocked ? "需要用户确认限制、补充权限或调整执行方式" : null,
    rawRunStatus: context.rawRunStatus,
  });
}

function terminalTimeoutRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const { evidence, rawRunStatus } = context;
  if (rawRunStatus !== "timed_out" && !isTerminalTimeout(evidence)) {
    return null;
  }
  const reason = summaryFromEvidence(evidence, "OpenClaw run 已终止于超时");
  return decide(context, "failed", {
    kind: "wait.timeout",
    strength: "medium",
    reasonCode: "openclaw.run_terminal_timeout",
    summary: reason,
    blockedReason: reason,
    resumeCondition: null,
    rawRunStatus,
  });
}

function completedRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const { evidence, job } = context;
  if (!hasTerminalSuccessSignal(context)) {
    return null;
  }
  if (hasNegativeToolFinding(evidence) || hasNegativeFinalReply(evidence)) {
    return null;
  }
  if (!hasBusinessCompletionEvidence(context)) {
    return null;
  }
  const classified = classifyBusinessEvidence(evidence, { goal: job.goal });
  const summary =
    classified.text ??
    pickMeaningfulBusinessText(evidence, null, job.goal) ??
    summaryFromEvidence(evidence, "OpenClaw 已返回可验收结果");
  return decide(context, "completed", {
    kind: hasMeaningfulTaskCompletion(evidence) ? "task.completed" : "wait.completed",
    strength: "medium",
    reasonCode: "openclaw.run_completed",
    summary,
    blockedReason: null,
    resumeCondition: null,
    rawRunStatus: context.rawRunStatus,
  });
}

function terminalWithoutResultRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (!hasTerminalSuccessSignal(context) || !isTerminalWithoutBusinessResult(context)) {
    return null;
  }
  const reason = "OpenClaw 已结束，但没有返回可验收的任务结果；需要张老板复验或换一种执行方式";
  return decide(context, "blocked", {
    kind: "wait.ended_without_result",
    strength: "medium",
    reasonCode: "openclaw.terminal_without_result",
    summary: reason,
    blockedReason: reason,
    resumeCondition: "需要张老板向用户说明执行结果缺失，并确认是否重试或换方案",
    rawRunStatus: context.rawRunStatus,
  });
}

function hasTerminalSuccessSignal(context: DecisionContext): boolean {
  return (
    context.rawRunStatus === "completed" ||
    isWaitOkWithTerminalEvidence(context.evidence) ||
    context.taskOutcome === "completed"
  );
}

function acceptedRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (context.rawRunStatus !== "accepted") {
    return null;
  }
  return decide(context, "running", {
    kind: "create.accepted",
    strength: "medium",
    reasonCode: "openclaw.accepted",
    summary: summaryFromEvidence(context.evidence, "OpenClaw 已接收任务"),
    blockedReason: null,
    resumeCondition: null,
    rawRunStatus: context.rawRunStatus,
  });
}

function waitOnlyTimeoutRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (!isWaitOnlyTimeout(context.evidence)) {
    return null;
  }
  return decide(context, "running", {
    kind: "wait.timeout",
    strength: "medium",
    reasonCode: "openclaw.wait_timeout_observing",
    summary: summaryFromEvidence(context.evidence, "OpenClaw 仍在执行，继续观察"),
    blockedReason: null,
    resumeCondition: null,
    rawRunStatus: context.rawRunStatus,
  });
}

function runningDecision(context: DecisionContext): OpenClawToLanxinJobDecision {
  return decide(context, "running", {
    kind: "wait.running",
    strength: "medium",
    reasonCode: context.rawRunStatus === "running" ? "openclaw.running" : "openclaw.insufficient_evidence",
    summary: summaryFromEvidence(context.evidence, "OpenClaw 正在执行"),
    blockedReason: null,
    resumeCondition: null,
    rawRunStatus: context.rawRunStatus,
  });
}

import type { DecisionContext, DecisionRule, OpenClawToLanxinJobDecision } from "./decision/types.js";
export type { OpenClawToLanxinJobDecision } from "./decision/types.js";

import { decide } from "./decision/result.js";

import { terminalJobRule } from "./decision/rules/terminal.js";
