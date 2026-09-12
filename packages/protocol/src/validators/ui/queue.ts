/**
 * 控制面板权限队列与最近错误摘要校验。
 *
 * 职责：校验 permission queue 与 last error summary。
 * 不拥有：renderer 渲染、凭据读取。
 * 纯函数：无 I/O。
 */

import { PERMISSION_IDS } from "../../messages/payloads/core.js";
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

const DECISIONS = ["allow_once", "allow_for_job", "deny", "require_more_context"] as const;

const QUEUE_ITEM_KEYS = [
  "permissionRequestId",
  "queueStatus",
  "requester",
  "affairId",
  "jobId",
  "requestedPermissions",
  "reason",
  "risk",
  "proposedScope",
  "availableDecisions",
  "denyConsequence",
  "requestedAt",
  "expiresAt",
] as const;

/**
 * 校验 proposedScope（UI 队列与协议共用形状）。
 *
 * @param value 待检值
 * @returns 通过或失败
 */
function validateProposedScope(value: unknown): ValidateResult<Record<string, unknown>> {
  const obj = expectObject(value, "proposedScope");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["workspaceRoot", "commands", "networkHosts"],
    "proposedScope",
  );
  if (!keys.ok) {
    return keys;
  }
  return { ok: true, value: obj.value };
}

/**
 * 校验非空枚举数组。
 *
 * @param value 待检数组
 * @param label 字段标签
 * @param allowed 枚举集合
 * @returns 通过或失败
 */
function expectNonEmptyEnumArray<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): ValidateResult<undefined> {
  if (!Array.isArray(value) || value.length < 1) {
    return {
      ok: false,
      error: { code: "validation_failed", message: `${label} 须非空`, retryable: false },
    };
  }
  for (let i = 0; i < value.length; i += 1) {
    const item = expectEnum(value[i], `${label}[${i}]`, allowed);
    if (!item.ok) {
      return item;
    }
  }
  return { ok: true, value: undefined };
}

/**
 * 校验 queue item 的枚举与时间字段。
 *
 * @param obj item 对象
 * @param label 标签
 * @returns 通过或失败
 */
function validateQueueItemScalars(
  obj: Record<string, unknown>,
  label: string,
): ValidateResult<undefined> {
  for (const field of ["permissionRequestId", "jobId", "reason", "denyConsequence"] as const) {
    const checked = expectNonEmptyString(obj[field], `${label}.${field}`);
    if (!checked.ok) {
      return checked;
    }
  }
  const queueStatus = expectEnum(obj.queueStatus, `${label}.queueStatus`, [
    "pending",
    "decided",
    "expired",
  ] as const);
  if (!queueStatus.ok) {
    return queueStatus;
  }
  const requester = expectEnum(obj.requester, `${label}.requester`, [
    "zhang-boss",
    "companion",
    "openclaw-adapter",
  ] as const);
  if (!requester.ok) {
    return requester;
  }
  const risk = expectEnum(obj.risk, `${label}.risk`, ["low", "medium", "high"] as const);
  if (!risk.ok) {
    return risk;
  }
  const requestedAt = expectDateTime(obj.requestedAt, `${label}.requestedAt`);
  if (!requestedAt.ok) {
    return requestedAt;
  }
  return { ok: true, value: undefined };
}

/**
 * 校验 permission queue item。
 *
 * @param value 待检项
 * @param label 标签
 * @returns 通过或失败
 */
function validateQueueItem(value: unknown, label: string): ValidateResult<Record<string, unknown>> {
  const obj = expectObject(value, label);
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, QUEUE_ITEM_KEYS, label);
  if (!keys.ok) {
    return keys;
  }
  const scalars = validateQueueItemScalars(obj.value, label);
  if (!scalars.ok) {
    return scalars;
  }
  const affairId = optionalField(obj.value, "affairId", (v) =>
    expectStringOrNull(v, `${label}.affairId`),
  );
  if (!affairId.ok) {
    return affairId;
  }
  const expiresAt = optionalField(obj.value, "expiresAt", (v) =>
    expectStringOrNull(v, `${label}.expiresAt`),
  );
  if (!expiresAt.ok) {
    return expiresAt;
  }
  const permissions = expectNonEmptyEnumArray(
    obj.value.requestedPermissions,
    `${label}.requestedPermissions`,
    PERMISSION_IDS,
  );
  if (!permissions.ok) {
    return permissions;
  }
  const decisions = expectNonEmptyEnumArray(
    obj.value.availableDecisions,
    `${label}.availableDecisions`,
    DECISIONS,
  );
  if (!decisions.ok) {
    return decisions;
  }
  const scope = validateProposedScope(obj.value.proposedScope);
  if (!scope.ok) {
    return scope;
  }
  return { ok: true, value: obj.value };
}

/**
 * 校验 permission queue。
 *
 * @param value 待检值
 * @returns 通过或失败
 */
export function validatePermissionQueue(value: unknown): ValidateResult<Record<string, unknown>> {
  const obj = expectObject(value, "permissionQueue");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["schemaVersion", "queueId", "generatedAt", "pendingCount", "items"],
    "permissionQueue",
  );
  if (!keys.ok) {
    return keys;
  }
  if (obj.value.schemaVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: `schemaVersion 必须为 ${PROTOCOL_VERSION}`,
        retryable: false,
      },
    };
  }
  const queueId = expectNonEmptyString(obj.value.queueId, "queueId");
  if (!queueId.ok) {
    return queueId;
  }
  const generatedAt = expectDateTime(obj.value.generatedAt, "generatedAt");
  if (!generatedAt.ok) {
    return generatedAt;
  }
  if (
    typeof obj.value.pendingCount !== "number" ||
    !Number.isInteger(obj.value.pendingCount) ||
    obj.value.pendingCount < 0
  ) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "pendingCount 必须是 >= 0 的整数",
        retryable: false,
      },
    };
  }
  if (!Array.isArray(obj.value.items)) {
    return {
      ok: false,
      error: { code: "validation_failed", message: "items 必须是数组", retryable: false },
    };
  }
  for (let i = 0; i < obj.value.items.length; i += 1) {
    const item = validateQueueItem(obj.value.items[i], `items[${i}]`);
    if (!item.ok) {
      return item;
    }
  }
  return { ok: true, value: obj.value };
}

export { validateLastErrorSummary } from "./errors/last-error.js";
