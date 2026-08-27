/**
 * createJob：创建 OpenClaw run 并登记 Lanxing job。
 *
 * 职责：校验入参、幂等重试、调用 runtime.createRun。
 * 不拥有：权限裁决、affair 关闭、真实 Gateway 配置。
 * 副作用：写 job store；调用 runtime（可能网络 I/O）。
 */

import type { OpenClawRuntimeClient } from "../client/runtime-client.js";
import { applyRunSnapshotToJob } from "../mapping/apply-run-snapshot.js";
import type { AdapterJobStore } from "./job-store.js";
import type { AdapterJobRecord, AdapterJobResult, CreateAdapterJobInput } from "./job-types.js";

/**
 * 校验创建入参。
 *
 * @param input 创建入参
 * @returns 错误结果或 null
 */
function validateCreateInput(input: CreateAdapterJobInput): AdapterJobResult | null {
  if (!input.jobId.trim()) {
    return { ok: false, code: "invalid_job_id", message: "jobId 不能为空", retryable: false };
  }
  if (!input.affairId.trim()) {
    return { ok: false, code: "invalid_affair_id", message: "affairId 不能为空", retryable: false };
  }
  if (!input.goal.trim()) {
    return { ok: false, code: "invalid_goal", message: "goal 不能为空", retryable: false };
  }
  if (!Array.isArray(input.allowedPermissions)) {
    return {
      ok: false,
      code: "invalid_permissions",
      message: "allowedPermissions 必须是数组（由 companion 显式传入）",
      retryable: false,
    };
  }
  return null;
}

/**
 * 同一 jobId 再次 create 时的幂等检查。
 *
 * @param existing 已有记录
 * @param input 新入参
 * @returns 可复用则 ok；冲突则失败
 */
function idempotentReuse(
  existing: AdapterJobRecord,
  input: CreateAdapterJobInput,
): AdapterJobResult {
  if (
    existing.affairId !== input.affairId ||
    existing.goal !== input.goal
  ) {
    return {
      ok: false,
      code: "job_id_conflict",
      message: "jobId 已存在但 affairId/goal 不一致，拒绝覆盖",
      retryable: false,
    };
  }
  return { ok: true, job: existing };
}

/**
 * 创建 adapter job：委派 runtime 并登记映射。
 *
 * @param store job 登记表
 * @param runtime OpenClaw runtime 客户端
 * @param input 显式权限与目标
 * @returns 成功记录或错误
 */
export async function createAdapterJob(
  store: AdapterJobStore,
  runtime: OpenClawRuntimeClient,
  input: CreateAdapterJobInput,
): Promise<AdapterJobResult> {
  const invalid = validateCreateInput(input);
  if (invalid) {
    return invalid;
  }

  const existing = store.get(input.jobId);
  if (existing) {
    return idempotentReuse(existing, input);
  }

  try {
    const snapshot = await runtime.createRun({
      input: input.goal,
      idempotencyKey: `lanxing-job:${input.jobId}`,
      workspaceHint: input.workspaceHint ?? null,
      sessionKey: `lanxing-job:${input.jobId}`,
    });

    const base: AdapterJobRecord = {
      jobId: input.jobId,
      affairId: input.affairId,
      status: "queued",
      goal: input.goal,
      workspaceHint: input.workspaceHint ?? null,
      allowedPermissions: [...input.allowedPermissions],
      openclawRunId: null,
      progressSummary: "",
      blockedReason: null,
      resumeCondition: null,
      lastRunStatus: null,
    };
    const job = applyRunSnapshotToJob(base, snapshot);
    store.set(job);
    return { ok: true, job };
  } catch (err) {
    const gateway = runtimeErrorResult(err, "create_run_failed");
    return {
      ok: false,
      code: gateway.code,
      message: gateway.message,
      retryable: gateway.retryable,
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
  return { code: "runtime_create_failed", message, retryable: true };
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
