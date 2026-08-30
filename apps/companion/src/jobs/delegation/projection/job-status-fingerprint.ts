/**
 * Job 用户可见状态指纹。
 *
 * 职责：判断同一 job 状态是否需要再次广播给 phone。
 * 不拥有：轮询、协议发送、adapter 状态裁决。
 * 纯函数：无 I/O。
 */

import type { JobStatus } from "@lanxin-claw/protocol";

/** 指纹输入。 */
export interface JobStatusFingerprintInput {
  /** job 状态。 */
  status: JobStatus;
  /** 用户可见进度摘要。 */
  progressSummary: string;
  /** 阻塞原因。 */
  blockedReason: string | null;
  /** 恢复条件。 */
  resumeCondition: string | null;
  /** 状态理由码。 */
  statusReasonCode?: string | null;
}

/**
 * 生成用户可见状态指纹。
 *
 * @param job job 用户可见字段
 * @returns 稳定 JSON 指纹
 */
export function jobStatusFingerprint(job: JobStatusFingerprintInput): string {
  return JSON.stringify({
    status: job.status,
    progressSummary: job.progressSummary,
    blockedReason: job.blockedReason,
    resumeCondition: job.resumeCondition,
    statusReasonCode: job.statusReasonCode ?? null,
  });
}
