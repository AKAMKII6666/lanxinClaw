/**
 * 将 runtime 快照合并进 adapter job 记录。
 *
 * 职责：统一 status / progress / blocker 字段更新，且遵守协议 job 状态机。
 * 不拥有：runtime I/O、affair 关闭。
 * 纯函数：返回新对象，不修改入参。
 *
 * 说明：轮询可能跳过中间态；仅当存在合法迁移路径（含经 running 等中间边）时才采纳映射状态。
 * 若本地已是终态则不再被非终态覆盖，避免 completed 被陈旧 running 回写。
 */

import {
  JOB_STATUSES,
  canTransitionJobStatus,
  type JobStatus,
} from "@lanxin-claw/protocol";
import type { OpenClawRunSnapshot } from "../client/runtime-client.js";
import {
  buildExecutionEvidence,
  type OpenClawExecutionEvidence,
} from "../evidence/openclaw-execution-evidence.js";
import type { AdapterJobRecord } from "../jobs/job-types.js";
import { decideJobFromEvidence } from "./decide-job-from-evidence.js";

const JOB_TERMINAL = new Set<JobStatus>(["completed", "failed", "canceled"]);
const ISO_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 在协议状态机上解析可采纳的下一 status。
 * 允许经最短合法路径到达目标（轮询漏中间态时先“走过”中间边），不可达则保持 from。
 *
 * @param from 当前 job 状态
 * @param to runtime 映射目标状态
 * @returns 可写出的下一状态
 */
function resolveNextJobStatus(from: JobStatus, to: JobStatus): JobStatus {
  if (from === to || canTransitionJobStatus(from, to)) {
    return to;
  }

  const queue: JobStatus[] = [from];
  const seen = new Set<JobStatus>([from]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of JOB_STATUSES) {
      if (next === cur || seen.has(next)) {
        continue;
      }
      if (!canTransitionJobStatus(cur, next)) {
        continue;
      }
      if (next === to) {
        return to;
      }
      seen.add(next);
      queue.push(next);
    }
  }
  return from;
}

/**
 * 用 OpenClaw run 快照刷新 job 记录。
 *
 * @param job 当前登记
 * @param snapshot runtime 快照
 * @returns 更新后的记录；非法迁移不静默写出；本地终态不被非终态回写
 */
export function applyRunSnapshotToJob(
  job: AdapterJobRecord,
  snapshot: OpenClawRunSnapshot,
): AdapterJobRecord {
  const evidence = evidenceForSnapshot(job, snapshot);
  const decided = decideJobFromEvidence(job, evidence);
  if (JOB_TERMINAL.has(job.status) && decided.status !== job.status) {
    return job;
  }
  const guarded =
    JOB_TERMINAL.has(job.status) && !JOB_TERMINAL.has(decided.status) ? job.status : decided.status;
  const nextStatus = resolveNextJobStatus(job.status, guarded);
  const now = new Date().toISOString();
  return {
    ...job,
    status: nextStatus,
    openclawRunId: snapshot.runId,
    progressSummary: decided.progressSummary || (snapshot.summary ?? job.progressSummary),
    blockedReason:
      nextStatus === "blocked" || nextStatus === "failed"
        ? decided.blockedReason ?? snapshot.blockedReason ?? job.blockedReason
        : null,
    resumeCondition:
      nextStatus === "blocked" || nextStatus === "needs_permission"
        ? decided.resumeCondition ?? snapshot.resumeCondition ?? job.resumeCondition
        : null,
    lastRunStatus: snapshot.status,
    statusReasonCode: decided.statusReasonCode,
    statusObservedAt: decided.statusObservedAt,
    lastEvidenceKind: decided.evidenceKind,
    lastEvidenceStrength: decided.evidenceStrength,
    updatedAt: now,
  };
}

function evidenceForSnapshot(
  job: AdapterJobRecord,
  snapshot: OpenClawRunSnapshot,
): OpenClawExecutionEvidence {
  const sessionKey = job.openclawSessionKey ?? `lanxing-job:${job.jobId}`;
  if (snapshot.evidence) {
    return {
      ...snapshot.evidence,
      jobId: snapshot.evidence.jobId ?? job.jobId,
      affairId: snapshot.evidence.affairId ?? job.affairId,
      sessionKey: snapshot.evidence.sessionKey ?? sessionKey,
      observedAt: normalizeObservedAt(snapshot.evidence.observedAt),
      toolFindings: [...(snapshot.evidence.toolFindings ?? [])],
      sourceStatuses: snapshot.evidence.sourceStatuses ?? [snapshot.status],
    };
  }
  return buildExecutionEvidence({
    runId: snapshot.runId,
    status: snapshot.status,
    ...(snapshot.summary !== undefined ? { summary: snapshot.summary } : {}),
    ...(snapshot.blockedReason !== undefined ? { blockedReason: snapshot.blockedReason } : {}),
    ...(snapshot.resumeCondition !== undefined ? { resumeCondition: snapshot.resumeCondition } : {}),
    jobId: job.jobId,
    affairId: job.affairId,
    sessionKey,
  });
}

function normalizeObservedAt(value: string | undefined): string {
  if (typeof value === "string" && ISO_DATE_TIME_RE.test(value)) {
    return value;
  }
  return new Date().toISOString();
}
