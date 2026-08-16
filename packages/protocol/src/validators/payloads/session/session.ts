/**
 * Session payload 校验。
 *
 * 职责：按 session.schema.json 校验 session.* 载荷。
 * 不拥有：会话票据存储、重连调度。
 * 纯函数：无 I/O。
 */

import { PROTOCOL_VERSION } from "../../../protocol-version.js";
import type {
  SessionAcceptedPayload,
  SessionClosedPayload,
  SessionHeartbeatPayload,
  SessionOpenPayload,
  SessionReauthRequiredPayload,
} from "../../../messages/payloads/session.js";
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
 * 校验 session.open。
 *
 * @param value 待检 payload
 * @returns SessionOpenPayload 或失败
 */
export function validateSessionOpenPayload(value: unknown): ValidateResult<SessionOpenPayload> {
  const obj = expectObject(value, "session.open");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["sessionId", "phoneDeviceId", "desktopDeviceId", "authProof", "protocolVersion"],
    "session.open",
  );
  if (!keys.ok) {
    return keys;
  }
  const sessionId = expectNonEmptyString(obj.value.sessionId, "sessionId");
  if (!sessionId.ok) {
    return sessionId;
  }
  const phoneDeviceId = expectNonEmptyString(obj.value.phoneDeviceId, "phoneDeviceId");
  if (!phoneDeviceId.ok) {
    return phoneDeviceId;
  }
  const desktopDeviceId = expectNonEmptyString(obj.value.desktopDeviceId, "desktopDeviceId");
  if (!desktopDeviceId.ok) {
    return desktopDeviceId;
  }
  const authProof = expectNonEmptyString(obj.value.authProof, "authProof");
  if (!authProof.ok) {
    return authProof;
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
  return {
    ok: true,
    value: {
      sessionId: sessionId.value,
      phoneDeviceId: phoneDeviceId.value,
      desktopDeviceId: desktopDeviceId.value,
      authProof: authProof.value,
      protocolVersion: PROTOCOL_VERSION,
    },
  };
}

/**
 * 校验 session.accepted。
 *
 * @param value 待检 payload
 * @returns SessionAcceptedPayload 或失败
 */
export function validateSessionAcceptedPayload(
  value: unknown,
): ValidateResult<SessionAcceptedPayload> {
  const obj = expectObject(value, "session.accepted");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["sessionId", "acceptedAt", "heartbeatIntervalMs"],
    "session.accepted",
  );
  if (!keys.ok) {
    return keys;
  }
  const sessionId = expectNonEmptyString(obj.value.sessionId, "sessionId");
  if (!sessionId.ok) {
    return sessionId;
  }
  const acceptedAt = expectDateTime(obj.value.acceptedAt, "acceptedAt");
  if (!acceptedAt.ok) {
    return acceptedAt;
  }
  if (
    typeof obj.value.heartbeatIntervalMs !== "number" ||
    !Number.isInteger(obj.value.heartbeatIntervalMs) ||
    obj.value.heartbeatIntervalMs < 1000
  ) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "heartbeatIntervalMs 必须是 >= 1000 的整数",
        retryable: false,
      },
    };
  }
  return {
    ok: true,
    value: {
      sessionId: sessionId.value,
      acceptedAt: acceptedAt.value,
      heartbeatIntervalMs: obj.value.heartbeatIntervalMs,
    },
  };
}

/**
 * 校验 session.heartbeat。
 *
 * @param value 待检 payload
 * @returns SessionHeartbeatPayload 或失败
 */
export function validateSessionHeartbeatPayload(
  value: unknown,
): ValidateResult<SessionHeartbeatPayload> {
  const obj = expectObject(value, "session.heartbeat");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, ["sessionId", "sentAt", "seq"], "session.heartbeat");
  if (!keys.ok) {
    return keys;
  }
  const sessionId = expectNonEmptyString(obj.value.sessionId, "sessionId");
  if (!sessionId.ok) {
    return sessionId;
  }
  const sentAt = expectDateTime(obj.value.sentAt, "sentAt");
  if (!sentAt.ok) {
    return sentAt;
  }
  const payload: SessionHeartbeatPayload = {
    sessionId: sessionId.value,
    sentAt: sentAt.value,
  };
  if ("seq" in obj.value) {
    if (typeof obj.value.seq !== "number" || !Number.isInteger(obj.value.seq) || obj.value.seq < 0) {
      return {
        ok: false,
        error: { code: "validation_failed", message: "seq 必须是 >= 0 的整数", retryable: false },
      };
    }
    payload.seq = obj.value.seq;
  }
  return { ok: true, value: payload };
}

/**
 * 校验 session.closed。
 *
 * @param value 待检 payload
 * @returns SessionClosedPayload 或失败
 */
export function validateSessionClosedPayload(value: unknown): ValidateResult<SessionClosedPayload> {
  const obj = expectObject(value, "session.closed");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, ["sessionId", "reason", "closedAt"], "session.closed");
  if (!keys.ok) {
    return keys;
  }
  const sessionId = expectNonEmptyString(obj.value.sessionId, "sessionId");
  if (!sessionId.ok) {
    return sessionId;
  }
  const reason = expectNonEmptyString(obj.value.reason, "reason");
  if (!reason.ok) {
    return reason;
  }
  const closedAt = expectDateTime(obj.value.closedAt, "closedAt");
  if (!closedAt.ok) {
    return closedAt;
  }
  return {
    ok: true,
    value: { sessionId: sessionId.value, reason: reason.value, closedAt: closedAt.value },
  };
}

/**
 * 校验 session.reauth_required。
 *
 * @param value 待检 payload
 * @returns SessionReauthRequiredPayload 或失败
 */
export function validateSessionReauthRequiredPayload(
  value: unknown,
): ValidateResult<SessionReauthRequiredPayload> {
  const obj = expectObject(value, "session.reauth_required");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["sessionId", "reason", "requiredAction"],
    "session.reauth_required",
  );
  if (!keys.ok) {
    return keys;
  }
  const sessionId = optionalField(obj.value, "sessionId", (v) => expectStringOrNull(v, "sessionId"));
  if (!sessionId.ok) {
    return sessionId;
  }
  const reason = expectNonEmptyString(obj.value.reason, "reason");
  if (!reason.ok) {
    return reason;
  }
  const requiredAction = expectEnum(obj.value.requiredAction, "requiredAction", [
    "reopen",
    "repair",
  ] as const);
  if (!requiredAction.ok) {
    return requiredAction;
  }
  const payload: SessionReauthRequiredPayload = {
    reason: reason.value,
    requiredAction: requiredAction.value,
  };
  if (sessionId.value !== undefined) {
    payload.sessionId = sessionId.value;
  }
  return { ok: true, value: payload };
}
