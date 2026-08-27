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
    const snapshot = await runtime.getRun(existing.openclawRunId);
    const job = applyRunSnapshotToJob(existing, snapshot);
    store.set(job);
    return { ok: true, job };
  } catch (err) {
    const runtime = runtimeErrorResult(err, "get_run_failed");
    return {
      ok: false,
      code: runtime.code,
      message: runtime.message,
      retryable: runtime.retryable,
    };
  }
}

function runtimeErrorResult(err: unknown, fallbackMessage: string): { code: string; message: string; retryable: boolean } {
  if (err && typeof err === "object") {
    const typed = err as { code?: unknown; message?: unknown; retryable?: unknown };
    if (typeof typed.code === "string" && typed.code.startsWith("gateway_")) {
      return {
        code: typed.code,
        message: typeof typed.message === "string" ? typed.message : fallbackMessage,
        retryable: typeof typed.retryable === "boolean" ? typed.retryable : isRetryableGatewayCode(typed.code),
      };
    }
  }
  const message = err instanceof Error ? err.message : fallbackMessage;
  if (message.startsWith("gateway_")) {
    return { code: message, message, retryable: isRetryableGatewayCode(message) };
  }
  return { code: "runtime_read_failed", message, retryable: true };
}

function isRetryableGatewayCode(code: string): boolean {
  return ![
    "gateway_url_missing",
    "gateway_agent_missing",
    "gateway_scope_missing",
    "gateway_auth_missing",
    "gateway_connect_rejected",
    "gateway_invalid_run",
  ].includes(code);
}
