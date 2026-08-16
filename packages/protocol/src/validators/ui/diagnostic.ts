/**
 * 控制面板诊断报告校验。
 *
 * 职责：校验 diagnostic report 与 probe item。
 * 不拥有：renderer 渲染、凭据读取。
 * 纯函数：无 I/O。
 */

import { PROTOCOL_VERSION } from "../../protocol-version.js";
import {
  expectDateTime,
  expectEnum,
  expectNonEmptyString,
  expectObject,
  expectStringOrNull,
  optionalField,
  rejectUnknownKeys,
} from "../primitives.js";
import type { ValidateResult } from "../result.js";
import { validateLastErrorSummary } from "./queue.js";

/**
 * 校验 probe item。
 *
 * @param value 待检值
 * @param label 标签
 * @returns 通过或失败
 */
function validateProbeItem(value: unknown, label: string): ValidateResult<Record<string, unknown>> {
  const obj = expectObject(value, label);
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["probeId", "label", "category", "status", "detail", "hint"],
    label,
  );
  if (!keys.ok) {
    return keys;
  }
  for (const field of ["probeId", "label"] as const) {
    const checked = expectNonEmptyString(obj.value[field], `${label}.${field}`);
    if (!checked.ok) {
      return checked;
    }
  }
  const category = expectEnum(obj.value.category, `${label}.category`, [
    "service",
    "environment",
  ] as const);
  if (!category.ok) {
    return category;
  }
  const status = expectEnum(obj.value.status, `${label}.status`, [
    "ok",
    "warn",
    "error",
    "unknown",
  ] as const);
  if (!status.ok) {
    return status;
  }
  if (typeof obj.value.detail !== "string") {
    return {
      ok: false,
      error: { code: "validation_failed", message: `${label}.detail 必须是字符串`, retryable: false },
    };
  }
  const hint = optionalField(obj.value, "hint", (v) => expectStringOrNull(v, `${label}.hint`));
  if (!hint.ok) {
    return hint;
  }
  return { ok: true, value: obj.value };
}

/**
 * 校验 probe 数组。
 *
 * @param value 待检数组
 * @param label 字段名
 * @returns 通过或失败
 */
function validateProbeList(value: unknown, label: string): ValidateResult<undefined> {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: { code: "validation_failed", message: `${label} 必须是数组`, retryable: false },
    };
  }
  for (let i = 0; i < value.length; i += 1) {
    const item = validateProbeItem(value[i], `${label}[${i}]`);
    if (!item.ok) {
      return item;
    }
  }
  return { ok: true, value: undefined };
}

/**
 * 校验 diagnostic 头部与 copyText。
 *
 * @param obj report 对象
 * @returns 通过或失败
 */
function validateDiagnosticHeader(obj: Record<string, unknown>): ValidateResult<undefined> {
  if (obj.schemaVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: `schemaVersion 必须为 ${PROTOCOL_VERSION}`,
        retryable: false,
      },
    };
  }
  const reportId = expectNonEmptyString(obj.reportId, "reportId");
  if (!reportId.ok) {
    return reportId;
  }
  const generatedAt = expectDateTime(obj.generatedAt, "generatedAt");
  if (!generatedAt.ok) {
    return generatedAt;
  }
  const overallStatus = expectEnum(obj.overallStatus, "overallStatus", [
    "ok",
    "warn",
    "error",
  ] as const);
  if (!overallStatus.ok) {
    return overallStatus;
  }
  if (typeof obj.copyText !== "string") {
    return {
      ok: false,
      error: { code: "validation_failed", message: "copyText 必须是字符串", retryable: false },
    };
  }
  return { ok: true, value: undefined };
}

/**
 * 校验 diagnostic report。
 *
 * @param value 待检值
 * @returns 通过或失败
 */
export function validateDiagnosticReport(value: unknown): ValidateResult<Record<string, unknown>> {
  const obj = expectObject(value, "diagnosticReport");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    [
      "schemaVersion",
      "reportId",
      "generatedAt",
      "overallStatus",
      "services",
      "environment",
      "lastError",
      "copyText",
    ],
    "diagnosticReport",
  );
  if (!keys.ok) {
    return keys;
  }
  const header = validateDiagnosticHeader(obj.value);
  if (!header.ok) {
    return header;
  }
  const services = validateProbeList(obj.value.services, "services");
  if (!services.ok) {
    return services;
  }
  const environment = validateProbeList(obj.value.environment, "environment");
  if (!environment.ok) {
    return environment;
  }
  if (obj.value.lastError !== null) {
    const lastError = validateLastErrorSummary(obj.value.lastError);
    if (!lastError.ok) {
      return lastError;
    }
  }
  return { ok: true, value: obj.value };
}
