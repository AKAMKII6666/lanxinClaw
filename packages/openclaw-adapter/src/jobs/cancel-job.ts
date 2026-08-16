/**
 * cancelJob：请求取消 OpenClaw run 并更新登记。
 *
 * 职责：对进行中 job 调用 runtime.cancelRun；终态幂等返回。
 * 不拥有：affair 关闭、权限 revoke。
 * 副作用：可能调用 runtime.cancelRun；回写 store。
 */

import { canTransitionJobStatus } from "@lanxin-claw/protocol";
import type { OpenClawRuntimeClient } from "../client/runtime-client.js";
import { applyRunSnapshotToJob } from "../mapping/apply-run-snapshot.js";
import type { AdapterJobStore } from "./job-store.js";
import type { AdapterJobResult } from "./job-types.js";

const TERMINAL = new Set(["completed", "failed", "canceled"]);

/**
 * 取消 adapter job。
 *
 * @param store job 登记表
 * @param runtime OpenClaw runtime 客户端
 * @param jobId 目标 job id
 * @returns 更新后的记录；已终态则幂等成功
 */
export async function cancelAdapterJob(
  store: AdapterJobStore,
  runtime: OpenClawRuntimeClient,
  jobId: string,
): Promise<AdapterJobResult> {
  const existing = store.get(jobId);
  if (!existing) {
    return {
      ok: false,
      code: "job_not_found",
      message: `找不到 jobId=${jobId}`,
      retryable: false,
    };
  }

  if (TERMINAL.has(existing.status)) {
    return { ok: true, job: existing };
  }

  if (!existing.openclawRunId) {
    if (!canTransitionJobStatus(existing.status, "canceled")) {
      return {
        ok: false,
        code: "cancel_not_allowed",
        message: `当前状态 ${existing.status} 无法取消`,
        retryable: false,
      };
    }
    const job = {
      ...existing,
      status: "canceled" as const,
      progressSummary: existing.progressSummary || "canceled_before_run",
      lastRunStatus: "cancelled",
    };
    store.set(job);
    return { ok: true, job };
  }

  try {
    const snapshot = await runtime.cancelRun(existing.openclawRunId);
    const job = applyRunSnapshotToJob(existing, snapshot);
    store.set(job);
    return { ok: true, job };
  } catch (err) {
    const message = err instanceof Error ? err.message : "cancel_run_failed";
    return {
      ok: false,
      code: "runtime_cancel_failed",
      message,
      retryable: true,
    };
  }
}
