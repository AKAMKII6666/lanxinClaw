/**
 * OpenClaw 证据 → Lanxin job 状态裁决。
 *
 * 职责：把 wait/audit/task/history 等观测证据合并为一个可解释的 job decision。
 * 不拥有：runtime I/O、job store 写入、affair 关闭、phone 协议发送。
 * 纯函数：不修改入参。
 */

import type { JobStatus } from "@lanxin-claw/protocol";
import type {
  OpenClawEvidenceKind,
  OpenClawEvidenceStrength,
  OpenClawExecutionEvidence,
} from "../evidence/openclaw-execution-evidence.js";
import type { AdapterJobRecord } from "../jobs/job-types.js";
import type { OpenClawRunStatus } from "../status/openclaw-run-status.js";
import {
  blockingFindingKind,
  classifyTask,
  containsBlockingText,
  failedFindingKind,
  firstBlockingFinding,
  firstFailedFinding,
  hasCancelledFinding,
  hasNegativeFinalReply,
  hasTerminalLifecycle,
  isLifecycleError,
  isTerminalTimeout,
  isWaitError,
  isWaitOkWithTerminalEvidence,
  isWaitOnlyTimeout,
  normalizeEvidenceRunStatus,
  resumeConditionFromEvidence,
  safeText,
  summaryFromEvidence,
  type TaskOutcome,
} from "./decision/evidence-helpers.js";

/** Lanxin 终态门闩。 */
const TERMINAL_JOB_STATUSES = new Set<JobStatus>(["completed", "failed", "canceled"]);

/** 裁决结果；只进入 adapter store，公开协议只投影安全字段。 */
export interface OpenClawToLanxinJobDecision {
  /** Lanxin job 状态。 */
  status: JobStatus;
  /** 用户可见进度或终态摘要。 */
  progressSummary: string;
  /** 用户可见阻塞原因；非阻塞可为 null。 */
  blockedReason: string | null;
  /** 用户可恢复条件；不可恢复或无需恢复可为 null。 */
  resumeCondition: string | null;
  /** 稳定理由码；供 companion/phone 精准回报。 */
  statusReasonCode: string;
  /** 证据观测时间 ISO-8601。 */
  statusObservedAt: string;
  /** 触发裁决的主要证据类别。 */
  evidenceKind: OpenClawEvidenceKind;
  /** 触发裁决的主要证据强度。 */
  evidenceStrength: OpenClawEvidenceStrength;
  /** OpenClaw 原始归一化状态；未知则为 null。 */
  rawRunStatus: string | null;
}

interface DecisionContext {
  job: AdapterJobRecord;
  evidence: OpenClawExecutionEvidence;
  rawRunStatus: OpenClawRunStatus | null;
  taskOutcome: TaskOutcome;
}

type DecisionRule = (context: DecisionContext) => OpenClawToLanxinJobDecision | null;

const DECISION_RULES: readonly DecisionRule[] = [
  terminalJobRule,
  cancellationRule,
  blockingFindingRule,
  waitingApprovalRule,
  negativeFinalReplyRule,
  failedFindingRule,
  taskBlockedRule,
  taskFailedRule,
  runFailedRule,
  lifecycleFailedRule,
  terminalTimeoutRule,
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

function terminalJobRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const { job, evidence } = context;
  if (!TERMINAL_JOB_STATUSES.has(job.status)) {
    return null;
  }
  return decision(job.status, evidence, {
    kind: "lanxin.terminal_latch",
    strength: "strong",
    reasonCode: "lanxin.terminal_latch",
    summary: job.progressSummary || summaryFromEvidence(evidence, "job 已在终态，拒绝迟到覆盖"),
    blockedReason: job.blockedReason,
    resumeCondition: job.resumeCondition,
    rawRunStatus: context.rawRunStatus,
  });
}

function cancellationRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const { evidence, rawRunStatus } = context;
  if (!evidence.localCancelAck && rawRunStatus !== "cancelled" && !hasCancelledFinding(evidence)) {
    return null;
  }
  return decision("canceled", evidence, {
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
  return decision("blocked", context.evidence, {
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
  return decision("needs_permission", context.evidence, {
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
  return decision("blocked", evidence, {
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
  const finding = firstFailedFinding(context.evidence);
  if (!finding) {
    return null;
  }
  const reason = safeText(
    finding.summary ?? finding.errorCode ?? summaryFromEvidence(context.evidence, "OpenClaw 工具执行失败"),
  );
  return decision("failed", context.evidence, {
    kind: failedFindingKind(finding),
    strength: "strong",
    reasonCode: finding.status === "timed_out" ? "openclaw.tool_timed_out" : "openclaw.tool_failed",
    summary: reason,
    blockedReason: reason,
    resumeCondition: null,
    rawRunStatus: context.rawRunStatus,
  });
}

function taskBlockedRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (context.taskOutcome !== "blocked") {
    return null;
  }
  const reason = summaryFromEvidence(context.evidence, "OpenClaw task ledger 显示任务被阻塞");
  return decision("blocked", context.evidence, {
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
  return decision("failed", context.evidence, {
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
  return decision(isBlocked ? "blocked" : "failed", evidence, {
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
  return decision(isBlocked ? "blocked" : "failed", context.evidence, {
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
  return decision("failed", evidence, {
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
  const { evidence, rawRunStatus, taskOutcome } = context;
  if (rawRunStatus !== "completed" && !isWaitOkWithTerminalEvidence(evidence) && taskOutcome !== "completed") {
    return null;
  }
  return decision("completed", evidence, {
    kind: taskOutcome === "completed" ? "task.completed" : "wait.completed",
    strength: "medium",
    reasonCode: "openclaw.run_completed",
    summary: summaryFromEvidence(evidence, "OpenClaw run 已结束"),
    blockedReason: null,
    resumeCondition: null,
    rawRunStatus,
  });
}

function acceptedRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  if (context.rawRunStatus !== "accepted") {
    return null;
  }
  return decision("running", context.evidence, {
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
  return decision("running", context.evidence, {
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
  return decision("running", context.evidence, {
    kind: "wait.running",
    strength: "medium",
    reasonCode: context.rawRunStatus === "running" ? "openclaw.running" : "openclaw.insufficient_evidence",
    summary: summaryFromEvidence(context.evidence, "OpenClaw 正在执行"),
    blockedReason: null,
    resumeCondition: null,
    rawRunStatus: context.rawRunStatus,
  });
}

function decision(
  status: JobStatus,
  evidence: OpenClawExecutionEvidence,
  input: {
    kind: OpenClawEvidenceKind;
    strength: OpenClawEvidenceStrength;
    reasonCode: string;
    summary: string;
    blockedReason: string | null;
    resumeCondition: string | null;
    rawRunStatus?: string | null;
  },
): OpenClawToLanxinJobDecision {
  return {
    status,
    progressSummary: safeText(input.summary),
    blockedReason: input.blockedReason === null ? null : safeText(input.blockedReason),
    resumeCondition: input.resumeCondition === null ? null : safeText(input.resumeCondition),
    statusReasonCode: input.reasonCode,
    statusObservedAt: evidence.observedAt,
    evidenceKind: input.kind,
    evidenceStrength: input.strength,
    rawRunStatus: input.rawRunStatus ?? normalizeEvidenceRunStatus(evidence),
  };
}
