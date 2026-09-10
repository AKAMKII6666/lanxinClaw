/** 职责：已确认终态门闩与空结果纠错条件。不拥有：执行与 affair 关闭。纯函数，无 I/O。 */
import type { JobStatus } from "@lanxin-claw/protocol";
import type { AdapterJobRecord } from "../../../jobs/job-types.js";
import {
isLowSignalText,
summaryFromEvidence
} from "../evidence-helpers.js";
import { decide } from "../result.js";
import type { DecisionContext, OpenClawToLanxinJobDecision } from "../types.js";


/** Lanxin 终态门闩。 */
const TERMINAL_JOB_STATUSES = new Set<JobStatus>(["completed", "failed", "canceled"]);

/**
 * 终态门闩；空壳 completed 仍允许证据纠错。
 * @param context 当前证据
 * @returns 保留的终态或继续裁决
 */
export function terminalJobRule(context: DecisionContext): OpenClawToLanxinJobDecision | null {
  const { job, evidence } = context;
  if (!TERMINAL_JOB_STATUSES.has(job.status)) {
    return null;
  }
  // 空壳 completed 允许被 terminal_without_result 纠为 blocked，不永久闩锁。
  if (isHollowCompletedJob(job)) {
    return null;
  }
  return decide(context, job.status, {
    kind: "lanxin.terminal_latch",
    strength: "strong",
    reasonCode: "lanxin.terminal_latch",
    summary: job.progressSummary || summaryFromEvidence(evidence, "job 已在终态，拒绝迟到覆盖"),
    blockedReason: job.blockedReason,
    resumeCondition: job.resumeCondition,
    rawRunStatus: context.rawRunStatus,
  });
}

/**
 * 空壳 completed：无 present 业务证据或摘要仍是低信号。
 *
 * @param job adapter job
 * @returns 可被纠错时为 true
 */
function isHollowCompletedJob(job: AdapterJobRecord): boolean {
  if (job.status !== "completed") {
    return false;
  }
  if (job.evidenceQuality !== "present") {
    return true;
  }
  return isLowSignalText(job.progressSummary) && isLowSignalText(job.resultDigest);
}
