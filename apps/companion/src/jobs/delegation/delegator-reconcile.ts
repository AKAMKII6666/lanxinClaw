/**
 * 启动时 reconciler：对齐 adapter run 与 backend/gate 状态。
 *
 * 职责：崩溃恢复后补轮询或自动委派；不重复 createRun。
 * 不拥有：权限裁决、配对、OpenClaw 配置。
 * 副作用：调用 delegator 恢复轮询或委派。
 */

import type { OpenClawAdapter } from "@lanxin-claw/openclaw-adapter";
import type { CompanionBackendRuntime } from "../../backend/runtime.js";
import type { JobDelegator } from "./delegator.js";

/**
 * 启动时 reconcile delegator 与 backend/adapter。
 *
 * @param delegator 任务委派器
 * @param backend 后端 runtime
 * @param adapter OpenClaw adapter
 * @returns Promise；完成时 in-flight 轮询或自动委派已恢复
 */
export async function reconcileDelegatorOnStartup(
  delegator: JobDelegator,
  backend: CompanionBackendRuntime,
  adapter: OpenClawAdapter,
): Promise<void> {
  const state = backend.getState();
  const gate = backend.getPermissionGate();

  for (const job of state.jobs.values()) {
    if (job.status !== "needs_permission") {
      continue;
    }
    const read = await adapter.readJob(job.jobId, { refresh: false });
    if (read.ok && read.job.openclawRunId) {
      await delegator.reconcileExistingAdapterRun(job.jobId, job.affairId);
    }
  }

  for (const permissionRequestId of gate.listDecidedGrantableRequestIds()) {
    const request = gate.getRequest(permissionRequestId);
    if (!request?.jobId) {
      continue;
    }
    if (state.jobs.get(request.jobId)?.status !== "needs_permission") {
      continue;
    }
    await delegator.handlePermissionGranted(permissionRequestId);
  }

  const inflightJobIds = [...state.jobs.values()]
    .filter((job) => job.status === "queued" || job.status === "running" || job.status === "blocked")
    .map((job) => job.jobId);
  if (inflightJobIds.length > 0) {
    await delegator.restoreInFlightPolling(inflightJobIds);
  }
}
