/**
 * Affair / Job payload 校验。
 *
 * 职责：按 affair.schema.json / job.schema.json 校验载荷。
 * 不拥有：状态迁移裁决（见 states）、OpenClaw 执行。
 * 纯函数：无 I/O。
 */

import { AFFAIR_STATUSES } from "../../../states/affair-status.js";
import { JOB_STATUSES } from "../../../states/job-status.js";
import type { AffairPayload, JobPayload } from "../../../messages/payloads/core.js";
import {
  expectDateTime,
  expectEnum,
  expectNonEmptyString,
  expectObject,
  expectStringArray,
  expectStringOrNull,
  optionalField,
  rejectUnknownKeys,
} from "../../primitives.js";
import type { ValidateErr, ValidateResult } from "../../result.js";

const AFFAIR_KEYS = [
  "affairId",
  "title",
  "ownerAgent",
  "status",
  "context",
  "acceptanceCriteria",
  "blockedReason",
  "resumeCondition",
  "currentJobId",
] as const;

const JOB_KEYS = [
  "jobId",
  "affairId",
  "executor",
  "status",
  "purpose",
  "goal",
  "workspaceHint",
  "allowedPermissions",
  "progressSummary",
  "blockedReason",
  "resumeCondition",
  "permissionRequestId",
  "taskIntentId",
  "statusReasonCode",
  "statusObservedAt",
] as const;

/**
 * 读取可选 string|null 字段并写入目标对象。
 *
 * @param obj 源对象
 * @param key 字段名
 * @param target 目标载荷
 * @returns 失败时返回错误结果；成功返回 null
 */
function assignOptionalStringOrNull<T extends object>(
  obj: Record<string, unknown>,
  key: keyof T & string,
  target: T,
): ValidateErr | null {
  const checked = optionalField(obj, key, (v) => expectStringOrNull(v, key));
  if (!checked.ok) {
    return checked;
  }
  if (checked.value !== undefined) {
    (target as Record<string, unknown>)[key] = checked.value;
  }
  return null;
}

/**
 * 读取可选 date-time|null 字段并写入 JobPayload。
 *
 * @param obj 源对象
 * @param key 字段名
 * @param target 目标载荷
 * @returns 失败时返回错误；成功返回 null
 */
function assignOptionalDateTimeOrNull(
  obj: Record<string, unknown>,
  key: "statusObservedAt",
  target: JobPayload,
): ValidateErr | null {
  if (!(key in obj)) {
    return null;
  }
  if (obj[key] === null) {
    target[key] = null;
    return null;
  }
  const checked = expectDateTime(obj[key], key);
  if (!checked.ok) {
    return checked;
  }
  target[key] = checked.value;
  return null;
}

/**
 * 校验 AffairPayload。
 *
 * @param value 待检 payload
 * @returns AffairPayload 或失败
 */
export function validateAffairPayload(value: unknown): ValidateResult<AffairPayload> {
  const obj = expectObject(value, "affair.payload");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, AFFAIR_KEYS, "affair.payload");
  if (!keys.ok) {
    return keys;
  }
  const affairId = expectNonEmptyString(obj.value.affairId, "affairId");
  if (!affairId.ok) {
    return affairId;
  }
  const title = expectNonEmptyString(obj.value.title, "title");
  if (!title.ok) {
    return title;
  }
  const ownerAgent = expectEnum(obj.value.ownerAgent, "ownerAgent", ["zhang-boss"] as const);
  if (!ownerAgent.ok) {
    return ownerAgent;
  }
  const status = expectEnum(obj.value.status, "status", AFFAIR_STATUSES);
  if (!status.ok) {
    return status;
  }
  const context = expectStringArray(obj.value.context, "context");
  if (!context.ok) {
    return context;
  }
  const acceptanceCriteria = expectStringArray(obj.value.acceptanceCriteria, "acceptanceCriteria");
  if (!acceptanceCriteria.ok) {
    return acceptanceCriteria;
  }
  const payload: AffairPayload = {
    affairId: affairId.value,
    title: title.value,
    ownerAgent: ownerAgent.value,
    status: status.value,
    context: context.value,
    acceptanceCriteria: acceptanceCriteria.value,
  };
  for (const key of ["blockedReason", "resumeCondition", "currentJobId"] as const) {
    const err = assignOptionalStringOrNull(obj.value, key, payload);
    if (err) {
      return err;
    }
  }
  return { ok: true, value: payload };
}

/**
 * 读取 job 必填字段。
 *
 * @param obj job payload 对象
 * @returns 必填字段集合或失败
 */
function readJobRequired(
  obj: Record<string, unknown>,
): ValidateResult<Omit<JobPayload, "workspaceHint" | "progressSummary" | "blockedReason" | "resumeCondition" | "permissionRequestId">> {
  const jobId = expectNonEmptyString(obj.jobId, "jobId");
  if (!jobId.ok) {
    return jobId;
  }
  const affairId = expectNonEmptyString(obj.affairId, "affairId");
  if (!affairId.ok) {
    return affairId;
  }
  const executor = expectEnum(obj.executor, "executor", ["openclaw"] as const);
  if (!executor.ok) {
    return executor;
  }
  const status = expectEnum(obj.status, "status", JOB_STATUSES);
  if (!status.ok) {
    return status;
  }
  const goal = expectNonEmptyString(obj.goal, "goal");
  if (!goal.ok) {
    return goal;
  }
  const allowedPermissions = expectStringArray(obj.allowedPermissions, "allowedPermissions");
  if (!allowedPermissions.ok) {
    return allowedPermissions;
  }
  return {
    ok: true,
    value: {
      jobId: jobId.value,
      affairId: affairId.value,
      executor: executor.value,
      status: status.value,
      goal: goal.value,
      allowedPermissions: allowedPermissions.value,
    },
  };
}

/**
 * 读取 job 可选字段并合并。
 *
 * @param obj 源对象
 * @param payload 已含必填字段的载荷
 * @returns 完整 JobPayload 或失败
 */
function mergeJobOptionals(
  obj: Record<string, unknown>,
  payload: JobPayload,
): ValidateResult<JobPayload> {
  if ("purpose" in obj) {
    const purpose = expectEnum(obj.purpose, "purpose", ["execution", "exploration"] as const);
    if (!purpose.ok) {
      return purpose;
    }
    payload.purpose = purpose.value;
  }
  if ("progressSummary" in obj) {
    if (typeof obj.progressSummary !== "string") {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "progressSummary 必须是字符串",
          retryable: false,
        },
      };
    }
    payload.progressSummary = obj.progressSummary;
  }
  for (const key of [
    "workspaceHint",
    "blockedReason",
    "resumeCondition",
    "permissionRequestId",
    "taskIntentId",
    "statusReasonCode",
  ] as const) {
    const err = assignOptionalStringOrNull(obj, key, payload);
    if (err) {
      return err;
    }
  }
  const observedAtErr = assignOptionalDateTimeOrNull(obj, "statusObservedAt", payload);
  if (observedAtErr) {
    return observedAtErr;
  }
  return { ok: true, value: payload };
}

/**
 * 校验 JobPayload。
 *
 * @param value 待检 payload
 * @returns JobPayload 或失败
 */
export function validateJobPayload(value: unknown): ValidateResult<JobPayload> {
  const obj = expectObject(value, "job.payload");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, JOB_KEYS, "job.payload");
  if (!keys.ok) {
    return keys;
  }
  const required = readJobRequired(obj.value);
  if (!required.ok) {
    return required;
  }
  return mergeJobOptionals(obj.value, { ...required.value });
}

const JOB_CANCEL_KEYS = ["jobId", "affairId"] as const;

/**
 * 校验 job.cancel 载荷：至少 jobId 与 affairId（与协议消息目录对齐）。
 *
 * @param value 待检 payload
 * @returns 取消载荷或失败
 */
export function validateJobCancelPayload(
  value: unknown,
): ValidateResult<{ jobId: string; affairId: string }> {
  const obj = expectObject(value, "job.cancel.payload");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, JOB_CANCEL_KEYS, "job.cancel.payload");
  if (!keys.ok) {
    return keys;
  }
  const jobId = expectNonEmptyString(obj.value.jobId, "jobId");
  if (!jobId.ok) {
    return jobId;
  }
  const affairId = expectNonEmptyString(obj.value.affairId, "affairId");
  if (!affairId.ok) {
    return affairId;
  }
  return { ok: true, value: { jobId: jobId.value, affairId: affairId.value } };
}
