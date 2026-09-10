/** 分离职责的协议校验；纯函数，无 I/O 或状态提交。 */
import { AFFAIR_STATUSES } from "../../states/affair-status.js";
import { JOB_STATUSES } from "../../states/job-status.js";
import {
expectDateTime,
expectEnum,
expectNonEmptyString,
expectObject,
expectStringArray,
expectStringOrNull
} from "../primitives.js";
import type { ValidateResult } from "../result.js";


/**
 * 校验 currentAffair 摘要；允许 null。
 *
 * @param value currentAffair 字段
 * @returns 通过或失败
 */
/** @param value 待校验事务 @param path 错误路径前缀 @returns 校验结果 */
export function validateCurrentAffair(value: unknown, path = "currentAffair"): ValidateResult<undefined> {
  if (value === null) {
    return { ok: true, value: undefined };
  }
  const affair = expectObject(value, path);
  if (!affair.ok) {
    return affair;
  }
  const base = validateCurrentAffairBase(affair.value, path);
  if (!base.ok) {
    return base;
  }
  const job = validateCurrentAffairJobFields(affair.value, path);
  if (!job.ok) {
    return job;
  }
  const arrays = validateCurrentAffairArrays(affair.value, path);
  if (!arrays.ok) {
    return arrays;
  }
  return validateCurrentAffairProgressFields(affair.value, path);
}

function validateCurrentAffairBase(
  affair: Record<string, unknown>,
  path: string,
): ValidateResult<undefined> {
  const affairId = expectNonEmptyString(affair.affairId, `${path}.affairId`);
  if (!affairId.ok) {
    return affairId;
  }
  const title = expectNonEmptyString(affair.title, `${path}.title`);
  if (!title.ok) {
    return title;
  }
  const status = expectEnum(affair.status, `${path}.status`, AFFAIR_STATUSES);
  if (!status.ok) {
    return status;
  }
  return { ok: true, value: undefined };
}

function validateCurrentAffairJobFields(
  affair: Record<string, unknown>,
  path: string,
): ValidateResult<undefined> {
  if (affair.currentJobStatus !== undefined && affair.currentJobStatus !== null) {
    const jobStatus = expectEnum(affair.currentJobStatus, `${path}.currentJobStatus`, JOB_STATUSES);
    if (!jobStatus.ok) {
      return jobStatus;
    }
  }
  for (const key of [
    "currentJobGoal",
    "currentJobProgressSummary",
    "currentJobBlockedReason",
    "currentJobResumeCondition",
    "currentJobStatusReasonCode",
  ] as const) {
    if (affair[key] !== undefined) {
      const checked = expectStringOrNull(affair[key], `${path}.${key}`);
      if (!checked.ok) {
        return checked;
      }
    }
  }
  if (affair.currentJobStatusObservedAt !== undefined && affair.currentJobStatusObservedAt !== null) {
    const observedAt = expectDateTime(affair.currentJobStatusObservedAt, `${path}.currentJobStatusObservedAt`);
    if (!observedAt.ok) {
      return observedAt;
    }
  }
  return { ok: true, value: undefined };
}

function validateCurrentAffairArrays(
  affair: Record<string, unknown>,
  path: string,
): ValidateResult<undefined> {
  if (affair.context !== undefined) {
    const context = expectStringArray(affair.context, `${path}.context`);
    if (!context.ok) {
      return context;
    }
  }
  if (affair.acceptanceCriteria !== undefined) {
    const criteria = expectStringArray(affair.acceptanceCriteria, `${path}.acceptanceCriteria`);
    if (!criteria.ok) {
      return criteria;
    }
  }
  return { ok: true, value: undefined };
}

function validateCurrentAffairProgressFields(
  affair: Record<string, unknown>,
  path: string,
): ValidateResult<undefined> {
  if (typeof affair.progressSummary !== "string") {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: `${path}.progressSummary 必须是字符串`,
        retryable: false,
      },
    };
  }
  const updatedAt = expectDateTime(affair.updatedAt, `${path}.updatedAt`);
  if (!updatedAt.ok) {
    return updatedAt;
  }
  return { ok: true, value: undefined };
}

/** @param value 待校验事务列表 @returns 校验结果 */
export function validateAffairs(value: unknown): ValidateResult<undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "affairs 必须是数组",
        retryable: false,
      },
    };
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = validateCurrentAffair(value[index], `affairs[${index}]`);
    if (!item.ok) {
      return item;
    }
  }
  return { ok: true, value: undefined };
}
