/**
 * Delegator job 载荷映射。
 *
 * 职责：adapter 快照 → 协议 JobPayload；状态 → envelope type。
 * 不拥有：轮询、权限、WS 发送。
 * 纯函数。
 */

import type {
  JobEvidenceQuality,
  JobPayload,
  JobRecentStep,
  JobStatus,
} from "@lanxin-claw/protocol";

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
    recentSteps?: readonly JobRecentStep[];
    resultDigest?: string | null;
    evidenceQuality?: JobEvidenceQuality;
    blockedReason: string | null;
    resumeCondition: string | null;
    permissionRequestId?: string | null;
    purpose?: "execution" | "exploration";
    statusReasonCode?: string | null;
    statusObservedAt?: string | null;
  },
  status: JobStatus,
): JobPayload {
  const progressSummary = redactOutboundText(job.progressSummary ?? "");
  const resultDigestRaw = job.resultDigest && String(job.resultDigest).trim() ? String(job.resultDigest) : null;
  return {
    jobId: job.jobId,
    affairId: job.affairId,
    executor: "openclaw",
    status,
    purpose: job.purpose ?? "execution",
    goal: job.goal,
    workspaceHint: job.workspaceHint ?? null,
    allowedPermissions: [...job.allowedPermissions],
    progressSummary,
    recentSteps: (job.recentSteps ?? []).map((step) => ({
      at: step.at,
      kind: step.kind,
      text: redactOutboundText(step.text).slice(0, 240) || step.kind,
    })),
    resultDigest: resultDigestRaw ? redactOutboundText(resultDigestRaw) || null : null,
    evidenceQuality: job.evidenceQuality ?? "missing",
    blockedReason: job.blockedReason === null || job.blockedReason === undefined
      ? job.blockedReason ?? null
      : redactOutboundText(job.blockedReason) || null,
    resumeCondition: job.resumeCondition === null || job.resumeCondition === undefined
      ? job.resumeCondition ?? null
      : redactOutboundText(job.resumeCondition) || null,
    permissionRequestId: job.permissionRequestId ?? null,
    statusReasonCode: job.statusReasonCode ?? null,
    statusObservedAt: job.statusObservedAt ?? null,
  };
}

/**
 * companion 出站最后一道脱敏；与 adapter safeText 对齐并纵深防御。
 *
 * @param value 原始文本
 * @returns 脱敏后文本
 */
function redactOutboundText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer ***")
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "jwt-***")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***")
    .replace(/(postgres(?:ql)?|mysql|mongodb):\/\/[^\s]+/gi, "$1://***")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[PRIVATE_KEY]")
    .slice(0, 800);
}

/**
 * job 状态 → 出站 envelope type。
 *
 * @param status 状态
 * @returns 消息类型
 */
export function statusToEnvelopeType(
  status: JobStatus,
): "job.accepted" | "job.progress" | "job.needs_permission" | "job.completed" | "job.blocked" | "job.failed" | "job.canceled" {
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
      return "job.canceled";
    case "needs_permission":
      return "job.needs_permission";
  }
}
