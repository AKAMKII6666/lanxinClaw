/**
 * 控制面板总览 snapshot 校验。
 *
 * 职责：校验 overview snapshot；不含凭据明文。
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
rejectUnknownKeys
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

import { validateAffairs,validateCurrentAffair } from "./affairs.js";

import { validateStatusCards } from "./status-cards.js";
