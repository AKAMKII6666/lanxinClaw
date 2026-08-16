/**
 * Envelope 校验。
 *
 * 职责：按 schemas/envelope.schema.json 校验顶层 envelope（不含 payload 业务形状）。
 * 不拥有：payload 域校验、会话认证状态机。
 * 纯函数：无 I/O。
 */

import { PROTOCOL_VERSION } from "../protocol-version.js";
import type { EndpointKind, ProtocolEnvelope, ProtocolEndpoint } from "../messages/envelope.js";
import {
  expectDateTime,
  expectEnum,
  expectNonEmptyString,
  expectObject,
  rejectUnknownKeys,
} from "./primitives.js";
import type { ValidateResult } from "./result.js";

const ENDPOINT_KINDS = ["phone", "companion", "adapter"] as const;
const TYPE_PATTERN = /^[a-z]+\.[a-z_]+$/;
const ENVELOPE_KEYS = [
  "protocolVersion",
  "messageId",
  "correlationId",
  "sentAt",
  "source",
  "target",
  "type",
  "payload",
] as const;

/**
 * 校验单个 endpoint。
 *
 * @param value 待检值
 * @param label 字段名
 * @returns ProtocolEndpoint 或失败
 */
function validateEndpoint(value: unknown, label: string): ValidateResult<ProtocolEndpoint> {
  const obj = expectObject(value, label);
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, ["kind", "deviceId"], label);
  if (!keys.ok) {
    return keys;
  }
  const kind = expectEnum<EndpointKind>(obj.value.kind, `${label}.kind`, ENDPOINT_KINDS);
  if (!kind.ok) {
    return kind;
  }
  const deviceId = expectNonEmptyString(obj.value.deviceId, `${label}.deviceId`);
  if (!deviceId.ok) {
    return deviceId;
  }
  return { ok: true, value: { kind: kind.value, deviceId: deviceId.value } };
}

/**
 * 校验协议 envelope 外壳。
 *
 * @param value 任意 JSON 值
 * @returns 收窄后的 ProtocolEnvelope 或失败
 */
export function validateEnvelope(value: unknown): ValidateResult<ProtocolEnvelope> {
  const obj = expectObject(value, "envelope");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, ENVELOPE_KEYS, "envelope");
  if (!keys.ok) {
    return keys;
  }
  if (obj.value.protocolVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: `protocolVersion 必须为 ${PROTOCOL_VERSION}`,
        retryable: false,
      },
    };
  }
  const messageId = expectNonEmptyString(obj.value.messageId, "messageId");
  if (!messageId.ok) {
    return messageId;
  }
  let correlationId: string | undefined;
  if ("correlationId" in obj.value) {
    const corr = expectNonEmptyString(obj.value.correlationId, "correlationId");
    if (!corr.ok) {
      return corr;
    }
    correlationId = corr.value;
  }
  const sentAt = expectDateTime(obj.value.sentAt, "sentAt");
  if (!sentAt.ok) {
    return sentAt;
  }
  const source = validateEndpoint(obj.value.source, "source");
  if (!source.ok) {
    return source;
  }
  const target = validateEndpoint(obj.value.target, "target");
  if (!target.ok) {
    return target;
  }
  const type = expectNonEmptyString(obj.value.type, "type");
  if (!type.ok) {
    return type;
  }
  if (!TYPE_PATTERN.test(type.value)) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "type 必须匹配 domain.action",
        retryable: false,
        details: { type: type.value },
      },
    };
  }
  const payload = expectObject(obj.value.payload, "payload");
  if (!payload.ok) {
    return payload;
  }
  const envelope: ProtocolEnvelope = {
    protocolVersion: PROTOCOL_VERSION,
    messageId: messageId.value,
    sentAt: sentAt.value,
    source: source.value,
    target: target.value,
    type: type.value,
    payload: payload.value,
  };
  if (correlationId !== undefined) {
    envelope.correlationId = correlationId;
  }
  return { ok: true, value: envelope };
}
