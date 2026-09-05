/**
 * 控制面板总览 snapshot 校验。
 *
 * 职责：校验 overview snapshot；不含凭据明文。
 * 不拥有：renderer 渲染、凭据读取。
 * 纯函数：无 I/O。
 */

import { PROTOCOL_VERSION } from "../../protocol-version.js";
import { AFFAIR_STATUSES } from "../../states/affair-status.js";
import { JOB_STATUSES } from "../../states/job-status.js";
import {
  expectDateTime,
  expectEnum,
  expectNonEmptyString,
  expectObject,
  expectStringArray,
  expectStringOrNull,
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
  "affairs",
  "recentActionDeliveries",
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
function validateCurrentAffair(value: unknown, path = "currentAffair"): ValidateResult<undefined> {
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

function validateAffairs(value: unknown): ValidateResult<undefined> {
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

function validateSideChannel(value: unknown): ValidateResult<undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  const channel = expectObject(value, "sideChannel");
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
  return { ok: true, value: undefined };
}

function validateRecentActionDeliveries(value: unknown): ValidateResult<undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "recentActionDeliveries 必须是数组",
        retryable: false,
      },
    };
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = expectObject(value[index], `recentActionDeliveries[${index}]`);
    if (!item.ok) {
      return item;
    }
    const receiptId = expectNonEmptyString(item.value.actionReceiptId, `recentActionDeliveries[${index}].actionReceiptId`);
    if (!receiptId.ok) {
      return receiptId;
    }
    const status = expectEnum(item.value.status, `recentActionDeliveries[${index}].status`, [
      "sent_to_phone",
      "queued_until_session",
      "rejected",
      "applied_locally",
      "waiting_for_callback",
    ] as const);
    if (!status.ok) {
      return status;
    }
    for (const key of ["affairId", "jobId", "reasonCode"] as const) {
      const checked = expectStringOrNull(item.value[key], `recentActionDeliveries[${index}].${key}`);
      if (!checked.ok) {
        return checked;
      }
    }
    if (item.value.deliveredAt !== null) {
      const deliveredAt = expectDateTime(item.value.deliveredAt, `recentActionDeliveries[${index}].deliveredAt`);
      if (!deliveredAt.ok) {
        return deliveredAt;
      }
    }
    const message = expectNonEmptyString(item.value.message, `recentActionDeliveries[${index}].message`);
    if (!message.ok) {
      return message;
    }
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
  const affairs = validateAffairs(obj.value.affairs);
  if (!affairs.ok) {
    return affairs;
  }
  const deliveries = validateRecentActionDeliveries(obj.value.recentActionDeliveries);
  if (!deliveries.ok) {
    return deliveries;
  }
  const sideChannel = validateSideChannel(obj.value.sideChannel);
  if (!sideChannel.ok) {
    return sideChannel;
  }
  return { ok: true, value: obj.value };
}
