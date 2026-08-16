/**
 * Pairing payload 校验。
 *
 * 职责：按 pairing.schema.json 校验 pairing.* 载荷。
 * 不拥有：配对确认 UI、会话票据存储。
 * 纯函数：无 I/O。
 */

import { PROTOCOL_VERSION } from "../../../protocol-version.js";
import type {
  PairingChallengePayload,
  PairingCompletedPayload,
  PairingConfirmedPayload,
  PairingDesktopApprovedPayload,
  PairingRequestPayload,
  PairingRevokedPayload,
} from "../../../messages/payloads/core.js";
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
import type { ValidateResult } from "../../result.js";

/**
 * 校验 pairing.request。
 *
 * @param value 待检 payload
 * @returns PairingRequestPayload 或失败
 */
export function validatePairingRequestPayload(value: unknown): ValidateResult<PairingRequestPayload> {
  const obj = expectObject(value, "pairing.request");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["pairingId", "phoneDeviceId", "phoneDisplayName", "protocolVersion", "capabilities"],
    "pairing.request",
  );
  if (!keys.ok) {
    return keys;
  }
  const pairingId = expectNonEmptyString(obj.value.pairingId, "pairingId");
  if (!pairingId.ok) {
    return pairingId;
  }
  const phoneDeviceId = expectNonEmptyString(obj.value.phoneDeviceId, "phoneDeviceId");
  if (!phoneDeviceId.ok) {
    return phoneDeviceId;
  }
  const phoneDisplayName = expectNonEmptyString(obj.value.phoneDisplayName, "phoneDisplayName");
  if (!phoneDisplayName.ok) {
    return phoneDisplayName;
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
  const capabilities = expectStringArray(obj.value.capabilities, "capabilities");
  if (!capabilities.ok) {
    return capabilities;
  }
  return {
    ok: true,
    value: {
      pairingId: pairingId.value,
      phoneDeviceId: phoneDeviceId.value,
      phoneDisplayName: phoneDisplayName.value,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: capabilities.value,
    },
  };
}

/**
 * 校验 pairing.challenge。
 *
 * @param value 待检 payload
 * @returns PairingChallengePayload 或失败
 */
export function validatePairingChallengePayload(
  value: unknown,
): ValidateResult<PairingChallengePayload> {
  const obj = expectObject(value, "pairing.challenge");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["pairingId", "desktopDeviceId", "desktopDisplayName", "challenge", "expiresAt"],
    "pairing.challenge",
  );
  if (!keys.ok) {
    return keys;
  }
  const pairingId = expectNonEmptyString(obj.value.pairingId, "pairingId");
  if (!pairingId.ok) {
    return pairingId;
  }
  const desktopDeviceId = expectNonEmptyString(obj.value.desktopDeviceId, "desktopDeviceId");
  if (!desktopDeviceId.ok) {
    return desktopDeviceId;
  }
  const desktopDisplayName = expectNonEmptyString(obj.value.desktopDisplayName, "desktopDisplayName");
  if (!desktopDisplayName.ok) {
    return desktopDisplayName;
  }
  const challenge = expectNonEmptyString(obj.value.challenge, "challenge");
  if (!challenge.ok) {
    return challenge;
  }
  const expiresAt = expectDateTime(obj.value.expiresAt, "expiresAt");
  if (!expiresAt.ok) {
    return expiresAt;
  }
  return {
    ok: true,
    value: {
      pairingId: pairingId.value,
      desktopDeviceId: desktopDeviceId.value,
      desktopDisplayName: desktopDisplayName.value,
      challenge: challenge.value,
      expiresAt: expiresAt.value,
    },
  };
}

/**
 * 校验 pairing.confirmed。
 *
 * @param value 待检 payload
 * @returns PairingConfirmedPayload 或失败
 */
export function validatePairingConfirmedPayload(
  value: unknown,
): ValidateResult<PairingConfirmedPayload> {
  const obj = expectObject(value, "pairing.confirmed");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["pairingId", "challengeResponse", "phoneConfirmedAt"],
    "pairing.confirmed",
  );
  if (!keys.ok) {
    return keys;
  }
  const pairingId = expectNonEmptyString(obj.value.pairingId, "pairingId");
  if (!pairingId.ok) {
    return pairingId;
  }
  const challengeResponse = expectNonEmptyString(obj.value.challengeResponse, "challengeResponse");
  if (!challengeResponse.ok) {
    return challengeResponse;
  }
  const phoneConfirmedAt = expectDateTime(obj.value.phoneConfirmedAt, "phoneConfirmedAt");
  if (!phoneConfirmedAt.ok) {
    return phoneConfirmedAt;
  }
  return {
    ok: true,
    value: {
      pairingId: pairingId.value,
      challengeResponse: challengeResponse.value,
      phoneConfirmedAt: phoneConfirmedAt.value,
    },
  };
}

/**
 * 校验 pairing.desktop_approved。
 *
 * @param value 待检 payload
 * @returns PairingDesktopApprovedPayload 或失败
 */
export function validatePairingDesktopApprovedPayload(
  value: unknown,
): ValidateResult<PairingDesktopApprovedPayload> {
  const obj = expectObject(value, "pairing.desktop_approved");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, ["pairingId", "desktopApprovedAt"], "pairing.desktop_approved");
  if (!keys.ok) {
    return keys;
  }
  const pairingId = expectNonEmptyString(obj.value.pairingId, "pairingId");
  if (!pairingId.ok) {
    return pairingId;
  }
  const desktopApprovedAt = expectDateTime(obj.value.desktopApprovedAt, "desktopApprovedAt");
  if (!desktopApprovedAt.ok) {
    return desktopApprovedAt;
  }
  return {
    ok: true,
    value: { pairingId: pairingId.value, desktopApprovedAt: desktopApprovedAt.value },
  };
}

/**
 * 校验 pairing.completed。
 *
 * @param value 待检 payload
 * @returns PairingCompletedPayload 或失败
 */
export function validatePairingCompletedPayload(
  value: unknown,
): ValidateResult<PairingCompletedPayload> {
  const obj = expectObject(value, "pairing.completed");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["pairingId", "phoneDeviceId", "desktopDeviceId", "pairedAt"],
    "pairing.completed",
  );
  if (!keys.ok) {
    return keys;
  }
  const pairingId = expectNonEmptyString(obj.value.pairingId, "pairingId");
  if (!pairingId.ok) {
    return pairingId;
  }
  const phoneDeviceId = expectNonEmptyString(obj.value.phoneDeviceId, "phoneDeviceId");
  if (!phoneDeviceId.ok) {
    return phoneDeviceId;
  }
  const desktopDeviceId = expectNonEmptyString(obj.value.desktopDeviceId, "desktopDeviceId");
  if (!desktopDeviceId.ok) {
    return desktopDeviceId;
  }
  const pairedAt = expectDateTime(obj.value.pairedAt, "pairedAt");
  if (!pairedAt.ok) {
    return pairedAt;
  }
  return {
    ok: true,
    value: {
      pairingId: pairingId.value,
      phoneDeviceId: phoneDeviceId.value,
      desktopDeviceId: desktopDeviceId.value,
      pairedAt: pairedAt.value,
    },
  };
}

/**
 * 校验 pairing.revoked。
 *
 * @param value 待检 payload
 * @returns PairingRevokedPayload 或失败
 */
export function validatePairingRevokedPayload(value: unknown): ValidateResult<PairingRevokedPayload> {
  const obj = expectObject(value, "pairing.revoked");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["pairingId", "phoneDeviceId", "desktopDeviceId", "reason", "revokedAt"],
    "pairing.revoked",
  );
  if (!keys.ok) {
    return keys;
  }
  const pairingId = optionalField(obj.value, "pairingId", (v) => expectStringOrNull(v, "pairingId"));
  if (!pairingId.ok) {
    return pairingId;
  }
  const phoneDeviceId = expectNonEmptyString(obj.value.phoneDeviceId, "phoneDeviceId");
  if (!phoneDeviceId.ok) {
    return phoneDeviceId;
  }
  const desktopDeviceId = expectNonEmptyString(obj.value.desktopDeviceId, "desktopDeviceId");
  if (!desktopDeviceId.ok) {
    return desktopDeviceId;
  }
  const reason = expectNonEmptyString(obj.value.reason, "reason");
  if (!reason.ok) {
    return reason;
  }
  const revokedAt = expectDateTime(obj.value.revokedAt, "revokedAt");
  if (!revokedAt.ok) {
    return revokedAt;
  }
  const payload: PairingRevokedPayload = {
    phoneDeviceId: phoneDeviceId.value,
    desktopDeviceId: desktopDeviceId.value,
    reason: reason.value,
    revokedAt: revokedAt.value,
  };
  if (pairingId.value !== undefined) {
    payload.pairingId = pairingId.value;
  }
  return { ok: true, value: payload };
}

