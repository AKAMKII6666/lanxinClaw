/** 职责：把规则结果与监督证据合成脱敏投影。不拥有：规则顺序或状态写入。纯函数。 */
import type { JobStatus } from "@lanxin-claw/protocol";
import type {
OpenClawEvidenceKind,
OpenClawEvidenceStrength
} from "../../evidence/openclaw-execution-evidence.js";
import {
classifyBusinessEvidence,
isLowSignalText,
normalizeEvidenceRunStatus,
pickMeaningfulBusinessText,
safeText
} from "./evidence-helpers.js";
import { buildSuperviseProjection } from "./supervise-projection.js";
import type { DecisionContext, OpenClawToLanxinJobDecision } from "./types.js";


/**
 * 合成可向用户投影的完整裁决结果。
 * @param context 原 job 与执行证据
 * @param status 规则裁决的目标状态
 * @param input 命中规则给出的理由与摘要
 * @returns 脱敏后的完整决策
 */
export function decide(
  context: DecisionContext,
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
): OpenClawToLanxinJobDecision {
  const evidence = context.evidence;
  const goal = context.job.goal;
  let progressSummary = safeText(input.summary);
  if (isLowSignalText(progressSummary)) {
    progressSummary =
      pickMeaningfulBusinessText(evidence, null, goal) ?? humanProgressFallback(status);
  }
  const classified = classifyBusinessEvidence(evidence, { goal, fallback: progressSummary });
  if (
    classified.quality === "present" &&
    classified.text &&
    /没有返回可验收/.test(progressSummary)
  ) {
    progressSummary = classified.text;
  }
  let blockedReason = input.blockedReason === null ? null : safeText(input.blockedReason);
  if (classified.quality === "present" && blockedReason && /没有返回可验收/.test(blockedReason)) {
    blockedReason = null;
  }
  // present 时不得保留空壳纠错理由码。
  let statusReasonCode = input.reasonCode;
  if (classified.quality === "present" && statusReasonCode === "openclaw.terminal_without_result") {
    statusReasonCode = "openclaw.run_completed";
  }
  const projection = buildSuperviseProjection(evidence, status, progressSummary, { goal });
  return {
    status,
    progressSummary,
    blockedReason,
    resumeCondition: input.resumeCondition === null ? null : safeText(input.resumeCondition),
    statusReasonCode,
    statusObservedAt: evidence.observedAt,
    evidenceKind: input.kind,
    evidenceStrength: input.strength,
    rawRunStatus: input.rawRunStatus ?? normalizeEvidenceRunStatus(evidence),
    recentSteps: projection.recentSteps,
    resultDigest: projection.resultDigest,
    evidenceQuality: projection.evidenceQuality,
  };
}

/**
 * 低信号摘要时的状态人话兜底。
 *
 * @param status job 状态
 * @returns 非低信号的人话进度
 */
function humanProgressFallback(status: JobStatus): string {
  switch (status) {
    case "completed":
      return "OpenClaw 已返回可验收结果";
    case "blocked":
      return "OpenClaw 执行被阻塞";
    case "failed":
      return "OpenClaw 执行失败";
    case "canceled":
      return "OpenClaw 已确认取消";
    case "needs_permission":
      return "OpenClaw 正在等待授权";
    case "queued":
      return "OpenClaw 已接收任务";
    case "running":
    default:
      return "OpenClaw 正在执行";
  }
}
