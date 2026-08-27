/**
 * Delegator job 载荷映射。
 *
 * 职责：adapter 快照 → 协议 JobPayload；状态 → envelope type。
 * 不拥有：轮询、权限、WS 发送。
 * 纯函数。
 */

import type { JobPayload, JobStatus } from "@lanxin-claw/protocol";

/**
 * 将 adapter job 快照映射为协议 JobPayload。
 *
 * @param job adapter 快照
 * @param status 状态
 * @returns 协议载荷
 */
export function toJobPayload(
  job: {
    jobId: string;
    affairId: string;
    goal: string;
    workspaceHint?: string | null;
    allowedPermissions: readonly string[];
    progressSummary: string;
    blockedReason: string | null;
    resumeCondition: string | null;
    permissionRequestId?: string | null;
  },
  status: JobStatus,
): JobPayload {
  return {
    jobId: job.jobId,
    affairId: job.affairId,
    executor: "openclaw",
    status,
    goal: job.goal,
    workspaceHint: job.workspaceHint ?? null,
    allowedPermissions: [...job.allowedPermissions],
    progressSummary: job.progressSummary ?? "",
    blockedReason: job.blockedReason ?? null,
    resumeCondition: job.resumeCondition ?? null,
    permissionRequestId: job.permissionRequestId ?? null,
  };
}

/**
 * job 状态 → 出站 envelope type。
 *
 * @param status 状态
 * @returns 消息类型
 */
export function statusToEnvelopeType(
  status: JobStatus,
): "job.accepted" | "job.progress" | "job.completed" | "job.blocked" | "job.failed" {
  switch (status) {
    case "queued":
    case "running":
      return "job.progress";
    case "completed":
      return "job.completed";
    case "blocked":
      return "job.blocked";
    case "failed":
      return "job.failed";
    case "canceled":
      return "job.progress";
    case "needs_permission":
      return "job.progress";
  }
}
