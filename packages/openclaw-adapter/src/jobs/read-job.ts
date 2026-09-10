/**
 * readJob：读取并可选刷新 job 状态。
 *
 * 职责：从 store 取登记，若有 openclawRunId 则向 runtime 拉取并映射。
 * 不拥有：创建 run、取消、affair 关闭。
 * 副作用：可能调用 runtime.getRun；成功时回写 store。
 */

import type { OpenClawRuntimeClient } from "../client/runtime-client.js";
import { applyRunSnapshotToJob } from "../mapping/apply-run-snapshot.js";
import type { AdapterJobStore } from "./job-store.js";
import type { AdapterJobResult } from "./job-types.js";
import { validateRunSnapshotIdentity } from "../evidence/snapshot-identity.js";
import { runtimeErrorResult } from "../client/runtime-error-result.js";
import { canonicalizeGatewaySessionKey, toGatewaySessionKey } from "../client/gateway/session-key.js";

/**
 * 读取 adapter job；默认刷新 runtime 状态。
 *
 * @param store job 登记表
 * @param runtime OpenClaw runtime 客户端
 * @param jobId 目标 job id
 * @param options.refresh 是否向 runtime 刷新；默认 true
 * @returns 成功记录或 not_found / runtime 错误
 */
export async function readAdapterJob(
  store: AdapterJobStore,
  runtime: OpenClawRuntimeClient,
  jobId: string,
  options?: { refresh?: boolean },
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

  const refresh = options?.refresh !== false;
  if (!refresh || !existing.openclawRunId) {
    return { ok: true, job: existing };
  }

  try {
    const sessionKey =
      canonicalizeGatewaySessionKey(existing.openclawSessionKey, "main", existing.jobId) ??
      toGatewaySessionKey(existing.jobId);
    const snapshot = await runtime.getRun(existing.openclawRunId, {
      jobId: existing.jobId,
      affairId: existing.affairId,
      sessionKey,
    });
    const identity = validateRunSnapshotIdentity(existing, snapshot);
    if (!identity.ok) {
      return {
        ok: false,
        code: "runtime_evidence_mismatch",
        message: identity.message,
        retryable: false,
      };
    }
    const job = applyRunSnapshotToJob(existing, snapshot);
    store.set(job);
    return { ok: true, job };
  } catch (err) {
    const runtime = runtimeErrorResult(err, "runtime_read_failed", "get_run_failed");
    return {
      ok: false,
      code: runtime.code,
      message: runtime.message,
      retryable: runtime.retryable,
    };
  }
}
