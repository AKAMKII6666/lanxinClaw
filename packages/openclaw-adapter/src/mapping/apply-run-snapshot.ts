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
import type { AdapterJobRecord } from "../jobs/job-types.js";
import { mapOpenClawRunStatusToJobStatus } from "./map-run-status.js";

const JOB_TERMINAL = new Set<JobStatus>(["completed", "failed", "canceled"]);

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
  const mapped = mapOpenClawRunStatusToJobStatus(snapshot.status);
  if (JOB_TERMINAL.has(job.status) && mapped !== job.status) {
    return job;
  }
  const guarded =
    JOB_TERMINAL.has(job.status) && !JOB_TERMINAL.has(mapped) ? job.status : mapped;
  const nextStatus = resolveNextJobStatus(job.status, guarded);
  return {
    ...job,
    status: nextStatus,
    openclawRunId: snapshot.runId,
    progressSummary: snapshot.summary ?? job.progressSummary,
    blockedReason: snapshot.blockedReason ?? job.blockedReason,
    resumeCondition: snapshot.resumeCondition ?? job.resumeCondition,
    lastRunStatus: snapshot.status,
  };
}
