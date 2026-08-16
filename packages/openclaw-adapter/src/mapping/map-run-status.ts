/**
 * OpenClaw run 状态 → Lanxing JobStatus 映射。
 *
 * 职责：把 runtime 窄状态翻译为协议 JobStatus。
 * 不拥有：affair 状态机、权限授予、真实 Gateway 调用。
 * 纯函数：无 I/O；`completed` 只表示 worker 完成，不表示 affair closed。
 */

import { type JobStatus } from "@lanxin-claw/protocol";
import type { OpenClawRunStatus } from "../status/openclaw-run-status.js";

/**
 * 将 OpenClaw run 状态映射为 Lanxing job 状态。
 *
 * @param runStatus runtime 规范化状态
 * @returns 对应的 JobStatus；超时按 failed（可带原因由调用方写入）
 */
export function mapOpenClawRunStatusToJobStatus(runStatus: OpenClawRunStatus): JobStatus {
  switch (runStatus) {
    case "accepted":
      return "running";
    case "running":
      return "running";
    case "waiting_approval":
      return "needs_permission";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
    case "timed_out":
      return "failed";
    case "cancelled":
      return "canceled";
    default: {
      const _exhaustive: never = runStatus;
      return _exhaustive;
    }
  }
}
