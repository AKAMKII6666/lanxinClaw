/** 分离职责的协议校验；纯函数，无 I/O 或状态提交。 */
import {
expectDateTime,
expectEnum,
expectNonEmptyString,
expectObject,
expectStringOrNull,
optionalField,
rejectUnknownKeys,
} from "../../primitives.js";
import type { ValidateResult } from "../../result.js";


/**
 * 校验 last error summary。
 *
 * @param value 待检值
 * @returns 通过或失败
 */
export function validateLastErrorSummary(value: unknown): ValidateResult<Record<string, unknown>> {
  const obj = expectObject(value, "lastErrorSummary");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["occurredAt", "code", "severity", "message", "affairId", "jobId", "retryable"],
    "lastErrorSummary",
  );
  if (!keys.ok) {
    return keys;
  }
  const occurredAt = expectDateTime(obj.value.occurredAt, "occurredAt");
  if (!occurredAt.ok) {
    return occurredAt;
  }
  const code = expectNonEmptyString(obj.value.code, "code");
  if (!code.ok) {
    return code;
  }
  const severity = expectEnum(obj.value.severity, "severity", ["info", "warn", "error"] as const);
  if (!severity.ok) {
    return severity;
  }
  const message = expectNonEmptyString(obj.value.message, "message");
  if (!message.ok) {
    return message;
  }
  if (typeof obj.value.retryable !== "boolean") {
    return {
      ok: false,
      error: { code: "validation_failed", message: "retryable 必须是布尔值", retryable: false },
    };
  }
  const affairId = optionalField(obj.value, "affairId", (v) => expectStringOrNull(v, "affairId"));
  if (!affairId.ok) {
    return affairId;
  }
  const jobId = optionalField(obj.value, "jobId", (v) => expectStringOrNull(v, "jobId"));
  if (!jobId.ok) {
    return jobId;
  }
  return { ok: true, value: obj.value };
}
