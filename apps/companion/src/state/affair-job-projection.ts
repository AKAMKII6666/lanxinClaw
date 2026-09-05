/**
 * job 到 affair 的安全投影。
 *
 * 职责：根据 current execution job 推导 affair 展示态与启动修复态。
 * 不拥有：协议 envelope 校验、store 写入时机、UI 渲染。
 * 纯函数，除 reconcile 写入被传入的 state 外无副作用。
 */

import {
  AFFAIR_STATUSES,
  canTransitionAffairStatus,
  type AffairPayload,
  type AffairStatus,
  type JobPayload,
  type JobStatus,
} from "@lanxin-claw/protocol";
import type { CompanionBackendState } from "./types.js";

const JOB_TO_AFFAIR_STATUS: Partial<Record<JobStatus, AffairStatus>> = {
  needs_permission: "delegated",
  queued: "delegated",
  running: "running",
  blocked: "blocked",
  failed: "blocked",
  completed: "waiting_acceptance",
  canceled: "blocked",
};

/**
 * @param job job
 * @returns 可投影的 affair 状态；未知返回 null
 */
export function affairStatusForJob(job: JobPayload): AffairStatus | null {
  return JOB_TO_AFFAIR_STATUS[job.status] ?? null;
}

/**
 * 从已持久化 job 反推 affair 执行态，用于启动时修复历史镜像里的旧状态。
 *
 * @param state backend state
 * @returns 修复条数
 */
export function reconcileAffairsFromJobs(state: CompanionBackendState): number {
  let changed = 0;
  for (const affair of state.affairs.values()) {
    const job = selectReconciliationJob(state, affair);
    if (!job) {
      continue;
    }
    const target = affairStatusForJob(job);
    if (!target || affair.status === "closed" || affair.status === "canceled") {
      continue;
    }
    const next = projectAffairWithJob(affair, job, target);
    if (!canReachAffairStatus(affair.status, next.status)) {
      continue;
    }
    if (affairNeedsRepair(affair, next)) {
      state.affairs.set(affair.affairId, next);
      changed += 1;
    }
  }
  if (changed > 0) {
    state.updatedAt = new Date().toISOString();
  }
  return changed;
}

function selectReconciliationJob(state: CompanionBackendState, affair: AffairPayload): JobPayload | null {
  const current = affair.currentJobId ? state.jobs.get(affair.currentJobId) : null;
  if (current && (current.purpose ?? "execution") !== "exploration") {
    return current;
  }
  if (affair.currentJobId) {
    return null;
  }
  let fallback: JobPayload | null = null;
  for (const job of state.jobs.values()) {
    if (job.affairId === affair.affairId && (job.purpose ?? "execution") !== "exploration") {
      fallback = job;
    }
  }
  return fallback;
}

/**
 * 根据 job 生成 affair 投影副本。
 *
 * @param affair 父事务
 * @param job 当前执行 job
 * @param status 目标事务状态
 * @returns affair 副本
 */
export function projectAffairWithJob(
  affair: AffairPayload,
  job: JobPayload,
  status: AffairStatus,
): AffairPayload {
  const isBlocked = status === "blocked";
  return {
    ...affair,
    status,
    currentJobId: job.jobId,
    blockedReason: isBlocked
      ? job.blockedReason ?? (job.status === "canceled" ? "last_execution_canceled" : "OpenClaw job failed")
      : null,
    resumeCondition: isBlocked
      ? job.resumeCondition ??
        (job.status === "canceled"
          ? "需要用户或张老板决定是否重新委派或取消事务"
          : job.status === "failed"
            ? "需要用户或张老板决定是否重试"
            : null)
      : null,
  };
}

function canReachAffairStatus(from: AffairStatus, to: AffairStatus): boolean {
  if (from === to || canTransitionAffairStatus(from, to)) {
    return true;
  }
  const queue: AffairStatus[] = [from];
  const seen = new Set<AffairStatus>([from]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of AFFAIR_STATUSES) {
      if (seen.has(next) || !canTransitionAffairStatus(cur, next)) {
        continue;
      }
      if (next === to) {
        return true;
      }
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

function affairNeedsRepair(left: AffairPayload, right: AffairPayload): boolean {
  return (
    left.status !== right.status ||
    (left.currentJobId ?? null) !== (right.currentJobId ?? null) ||
    (left.blockedReason ?? null) !== (right.blockedReason ?? null) ||
    (left.resumeCondition ?? null) !== (right.resumeCondition ?? null)
  );
}
