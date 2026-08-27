/**
 * 控制面板总览 snapshot 校验。
 *
 * 职责：校验 overview snapshot；不含凭据明文。
 * 不拥有：renderer 渲染、凭据读取。
 * 纯函数：无 I/O。
 */

import { PROTOCOL_VERSION } from "../../protocol-version.js";
import { AFFAIR_STATUSES } from "../../states/affair-status.js";
import {
  expectDateTime,
  expectEnum,
  expectNonEmptyString,
  expectObject,
  rejectUnknownKeys,
} from "../primitives.js";
import type { ValidateResult } from "../result.js";

const SNAPSHOT_KEYS = [
  "schemaVersion",
  "snapshotId",
  "generatedAt",
  "companion",
  "clawCore",
  "credential",
  "device",
  "zhangBoss",
  "currentAffair",
  "sideChannel",
] as const;

/**
 * 校验五段状态卡的 status 枚举与关键字段。
 *
 * @param obj snapshot 对象
 * @returns 通过或失败
 */
function validateStatusCards(obj: Record<string, unknown>): ValidateResult<undefined> {
  for (const section of ["companion", "clawCore", "credential", "device", "zhangBoss"] as const) {
    const sectionObj = expectObject(obj[section], section);
    if (!sectionObj.ok) {
      return sectionObj;
    }
  }
  const companionStatus = expectEnum(
    (obj.companion as Record<string, unknown>).status,
    "companion.status",
    ["stopped", "starting", "running", "degraded", "error"] as const,
  );
  if (!companionStatus.ok) {
    return companionStatus;
  }
  const claw = obj.clawCore as Record<string, unknown>;
  const clawStatus = expectEnum(claw.status, "clawCore.status", [
    "not_installed",
    "stopped",
    "starting",
    "running",
    "error",
  ] as const);
  if (!clawStatus.ok) {
    return clawStatus;
  }
  if (typeof claw.adapterReady !== "boolean") {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "clawCore.adapterReady 必须是布尔值",
        retryable: false,
      },
    };
  }
  const credential = obj.credential as Record<string, unknown>;
  const credentialStatus = expectEnum(credential.status, "credential.status", [
    "missing",
    "synced",
    "expired",
    "needs_reauth",
  ] as const);
  if (!credentialStatus.ok) {
    return credentialStatus;
  }
  const provider = expectNonEmptyString(credential.provider, "credential.provider");
  if (!provider.ok) {
    return provider;
  }
  const deviceStatus = expectEnum(
    (obj.device as Record<string, unknown>).status,
    "device.status",
    ["undiscovered", "discovered", "pairing", "connected", "disconnected"] as const,
  );
  if (!deviceStatus.ok) {
    return deviceStatus;
  }
  const zhangStatus = expectEnum(
    (obj.zhangBoss as Record<string, unknown>).status,
    "zhangBoss.status",
    ["offline", "online", "in_call", "supervising", "waiting_user"] as const,
  );
  if (!zhangStatus.ok) {
    return zhangStatus;
  }
  return { ok: true, value: undefined };
}

/**
 * 校验 currentAffair 摘要；允许 null。
 *
 * @param value currentAffair 字段
 * @returns 通过或失败
 */
function validateCurrentAffair(value: unknown): ValidateResult<undefined> {
  if (value === null) {
    return { ok: true, value: undefined };
  }
  const affair = expectObject(value, "currentAffair");
  if (!affair.ok) {
    return affair;
  }
  const affairId = expectNonEmptyString(affair.value.affairId, "currentAffair.affairId");
  if (!affairId.ok) {
    return affairId;
  }
  const title = expectNonEmptyString(affair.value.title, "currentAffair.title");
  if (!title.ok) {
    return title;
  }
  const status = expectEnum(affair.value.status, "currentAffair.status", AFFAIR_STATUSES);
  if (!status.ok) {
    return status;
  }
  if (typeof affair.value.progressSummary !== "string") {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "currentAffair.progressSummary 必须是字符串",
        retryable: false,
      },
    };
  }
  const updatedAt = expectDateTime(affair.value.updatedAt, "currentAffair.updatedAt");
  if (!updatedAt.ok) {
    return updatedAt;
  }
  return { ok: true, value: undefined };
}

/**
 * 校验总览 snapshot。
 *
 * @param value 待检值
 * @returns 通过或失败
 */
export function validateControlPanelSnapshot(
  value: unknown,
): ValidateResult<Record<string, unknown>> {
  const obj = expectObject(value, "controlPanelSnapshot");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, SNAPSHOT_KEYS, "controlPanelSnapshot");
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
  const snapshotId = expectNonEmptyString(obj.value.snapshotId, "snapshotId");
  if (!snapshotId.ok) {
    return snapshotId;
  }
  const generatedAt = expectDateTime(obj.value.generatedAt, "generatedAt");
  if (!generatedAt.ok) {
    return generatedAt;
  }
  const cards = validateStatusCards(obj.value);
  if (!cards.ok) {
    return cards;
  }
  const affair = validateCurrentAffair(obj.value.currentAffair);
  if (!affair.ok) {
    return affair;
  }
  if (obj.value.sideChannel !== undefined) {
    const channel = expectObject(obj.value.sideChannel, "sideChannel");
    if (!channel.ok) {
      return channel;
    }
    if (typeof channel.value.pendingContextCount !== "number") {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "sideChannel.pendingContextCount 必须是数字",
          retryable: false,
        },
      };
    }
    if (!Array.isArray(channel.value.messages) || !Array.isArray(channel.value.attachments)) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "sideChannel.messages / attachments 必须是数组",
          retryable: false,
        },
      };
    }
  }
  return { ok: true, value: obj.value };
}
