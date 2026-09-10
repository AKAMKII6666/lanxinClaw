/**
 * createJob：创建 OpenClaw run 并登记 Lanxing job。
 *
 * 职责：校验入参、幂等重试、调用 runtime.createRun。
 * 不拥有：权限裁决、affair 关闭、真实 Gateway 配置。
 * 副作用：写 job store；调用 runtime（可能网络 I/O）。
 */

import { PERMISSION_IDS } from "@lanxin-claw/protocol";
import type { OpenClawRuntimeClient } from "../client/runtime-client.js";
import { applyRunSnapshotToJob } from "../mapping/apply-run-snapshot.js";
import type { AdapterJobStore } from "./job-store.js";
import type { AdapterJobRecord, AdapterJobResult, CreateAdapterJobInput } from "./job-types.js";
import { validateRunSnapshotIdentity } from "../evidence/snapshot-identity.js";
import { runtimeErrorResult } from "../client/runtime-error-result.js";
import { toGatewaySessionKey, toJobIdempotencyKey } from "../client/gateway/session-key.js";

const KNOWN_PERMISSION_IDS = new Set<string>(PERMISSION_IDS);

const BROWSER_FIRST_PREFIX =
  "【执行约束】查资料/查价/搜新闻/打开网页时：必须优先使用 browser 打开目标站并读取可见结果；" +
  "web_fetch 仅当浏览器不可用或需要原文/API 时使用；不要调用 web_search。\n\n任务目标：";

/**
 * 查资料类 goal 是否附加 browser-first 委派前缀。
 * 与 companion `classifyJobWebCapabilityNeed` 对齐，避免对纯本地「查询」误包装。
 *
 * @param goal 原始目标
 * @returns 需要则 true
 */
function needsBrowserFirstGoalWrap(goal: string): boolean {
  const text = goal.trim();
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  if (/https?:\/\//i.test(text) || /联网|网页/.test(text)) {
    return true;
  }
  if (/浏览器|打开网页|webpage|browser|点击|gui/.test(text) || /browser/.test(lower)) {
    return true;
  }
  return (
    /搜索|搜一下|查.{0,8}(价格|新闻|网页|资料)|web_search|google|bing/.test(text) ||
    /search|news|price/.test(lower)
  );
}

/**
 * 包装 createRun message；job 记录仍存原始 goal。
 *
 * @param goal 原始目标
 * @returns Gateway message
 */
function wrapBrowserFirstRunInput(goal: string): string {
  const trimmed = goal.trim();
  if (!needsBrowserFirstGoalWrap(trimmed)) {
    return trimmed;
  }
  return `${BROWSER_FIRST_PREFIX}${trimmed}`;
}

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
  if (input.purpose && input.purpose !== "execution" && input.purpose !== "exploration") {
    return { ok: false, code: "invalid_purpose", message: "purpose 非法", retryable: false };
  }
  if (!Array.isArray(input.allowedPermissions)) {
    return {
      ok: false,
      code: "invalid_permissions",
      message: "allowedPermissions 必须是数组（由 companion 显式传入）",
      retryable: false,
    };
  }
  if (input.allowedPermissions.length === 0) {
    return {
      ok: false,
      code: "invalid_permissions",
      message: "allowedPermissions 不得为空，adapter 不得无授权委派执行",
      retryable: false,
    };
  }
  if (input.allowedPermissions.some((permission) => typeof permission !== "string" || !permission.trim())) {
    return {
      ok: false,
      code: "invalid_permissions",
      message: "allowedPermissions 只能包含非空权限 id",
      retryable: false,
    };
  }
  if (input.allowedPermissions.some((permission) => !KNOWN_PERMISSION_IDS.has(permission))) {
    return {
      ok: false,
      code: "invalid_permissions",
      message: "allowedPermissions 含未知权限 id",
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
    existing.goal !== input.goal ||
    (existing.purpose ?? "execution") !== (input.purpose ?? "execution")
  ) {
    return {
      ok: false,
      code: "job_id_conflict",
      message: "jobId 已存在但 affairId/goal/purpose 不一致，拒绝覆盖",
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
    const sessionKey = toGatewaySessionKey(input.jobId);
    const idempotencyKey = toJobIdempotencyKey(input.jobId);
    const now = new Date().toISOString();
    const snapshot = await runtime.createRun({
      jobId: input.jobId,
      affairId: input.affairId,
      input: wrapBrowserFirstRunInput(input.goal),
      idempotencyKey,
      workspaceHint: input.workspaceHint ?? null,
      allowedPermissions: [...input.allowedPermissions],
      sessionKey,
    });

    const base: AdapterJobRecord = {
      jobId: input.jobId,
      affairId: input.affairId,
      status: "queued",
      goal: input.goal,
      purpose: input.purpose ?? "execution",
      workspaceHint: input.workspaceHint ?? null,
      allowedPermissions: [...input.allowedPermissions],
      openclawRunId: null,
      openclawSessionKey: sessionKey,
      progressSummary: "",
      recentSteps: [],
      resultDigest: null,
      evidenceQuality: "missing",
      blockedReason: null,
      resumeCondition: null,
      lastRunStatus: null,
      statusReasonCode: null,
      statusObservedAt: null,
      lastEvidenceKind: null,
      lastEvidenceStrength: null,
      createdAt: now,
      updatedAt: now,
    };
    const identity = validateRunSnapshotIdentity(base, snapshot);
    if (!identity.ok) {
      return {
        ok: false,
        code: "runtime_evidence_mismatch",
        message: identity.message,
        retryable: false,
      };
    }
    const job = applyRunSnapshotToJob(base, snapshot);
    store.set(job);
    return { ok: true, job };
  } catch (err) {
    const gateway = runtimeErrorResult(err, "runtime_create_failed", "create_run_failed");
    return {
      ok: false,
      code: gateway.code,
      message: gateway.message,
      retryable: gateway.retryable,
    };
  }
}
