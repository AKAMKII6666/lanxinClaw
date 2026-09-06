/**
 * OpenClaw 证据 → 监督投影。
 *
 * 职责：把内部证据归一为可发给 phone 的 recentSteps / resultDigest / evidenceQuality。
 * 不拥有：job 状态裁决、raw evidence 透传、affair 关闭。
 * 纯函数：不修改入参。
 */

import type { JobEvidenceQuality, JobRecentStep, JobRecentStepKind, JobStatus } from "@lanxin-claw/protocol";
import type { OpenClawExecutionEvidence, OpenClawToolFinding } from "../../evidence/openclaw-execution-evidence.js";
import {
  hasBusinessEntitySignal,
  isLowSignalText,
  isMeaningfulCompletionText,
  pickMeaningfulBusinessText,
  safeText,
} from "./evidence-helpers.js";

/** 监督投影结果；只含脱敏后的公开字段。 */
export interface SuperviseProjection {
  /** 最近执行步骤；最多 8 条。 */
  recentSteps: JobRecentStep[];
  /** 终态可验收摘要；低信号或缺失时为 null。 */
  resultDigest: string | null;
  /** 证据质量；phone 据此生成 reportHint，不得驱动高风险状态机。 */
  evidenceQuality: JobEvidenceQuality;
}

const MAX_RECENT_STEPS = 8;
const MAX_STEP_TEXT = 240;

/**
 * 从证据生成监督投影。
 *
 * @param evidence OpenClaw 观测证据
 * @param status 已裁决的 Lanxin job 状态
 * @param progressSummary 已归一的进度摘要
 * @returns 监督投影
 */
export function buildSuperviseProjection(
  evidence: OpenClawExecutionEvidence,
  status: JobStatus,
  progressSummary: string,
): SuperviseProjection {
  const recentSteps = collectRecentSteps(evidence);
  const business = pickMeaningfulBusinessText(evidence, progressSummary);

  if (status === "completed") {
    if (!business) {
      return { recentSteps, resultDigest: null, evidenceQuality: "missing" };
    }
    if (hasBusinessEntitySignal(business)) {
      return { recentSteps, resultDigest: business, evidenceQuality: "present" };
    }
    return { recentSteps, resultDigest: business, evidenceQuality: "weak" };
  }

  if (status === "blocked" || status === "failed") {
    const digest =
      business ?? (isMeaningfulCompletionText(progressSummary) ? safeText(progressSummary) : null);
    if (!digest) {
      return { recentSteps, resultDigest: null, evidenceQuality: "weak" };
    }
    return {
      recentSteps,
      resultDigest: digest,
      evidenceQuality: hasBusinessEntitySignal(digest) ? "present" : "weak",
    };
  }

  return {
    recentSteps,
    resultDigest: null,
    evidenceQuality: business || recentSteps.length > 0 ? "weak" : "missing",
  };
}

/**
 * 收集脱敏后的最近步骤。
 *
 * @param evidence OpenClaw 观测证据
 * @returns 最多 8 条步骤
 */
function collectRecentSteps(evidence: OpenClawExecutionEvidence): JobRecentStep[] {
  const at = evidence.observedAt;
  const steps: JobRecentStep[] = evidence.toolFindings
    .map((finding) => toolStep(at, finding))
    .filter((step): step is JobRecentStep => step !== null);

  pushMeaningfulStep(steps, at, "lifecycle", evidence.lifecycle?.terminalReason ?? evidence.lifecycle?.terminalPhase);
  pushMeaningfulStep(steps, at, "task", evidence.task?.progressSummary ?? evidence.task?.terminalSummary);
  pushMeaningfulStep(steps, at, "reply", evidence.finalReply?.text);
  return steps.slice(-MAX_RECENT_STEPS);
}

/**
 * 将 tool finding 投影为步骤。
 *
 * @param at 观测时间
 * @param finding tool 证据
 * @returns 步骤或 null
 */
function toolStep(at: string, finding: OpenClawToolFinding): JobRecentStep | null {
  const raw = safeText(finding.summary ?? finding.errorCode ?? "");
  const labeled = finding.toolName
    ? safeText(isLowSignalText(raw) || !raw ? finding.toolName : `${finding.toolName}: ${raw}`)
    : raw;
  if (!labeled) {
    return null;
  }
  return { at, kind: "tool", text: labeled.slice(0, MAX_STEP_TEXT) };
}

/**
 * 追加非低信号步骤。
 *
 * @param steps 步骤累加器
 * @param at 观测时间
 * @param kind 步骤类别
 * @param value 原始文本
 */
function pushMeaningfulStep(
  steps: JobRecentStep[],
  at: string,
  kind: JobRecentStepKind,
  value: string | null | undefined,
): void {
  const text = safeText(value ?? "");
  if (!text || isLowSignalText(text)) {
    return;
  }
  steps.push({ at, kind, text: text.slice(0, MAX_STEP_TEXT) });
}
