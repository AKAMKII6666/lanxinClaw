/**
 * Pairing payload 校验。
 *
 * 职责：按 pairing.schema.json 校验 pairing.* 载荷。
 * 不拥有：配对确认 UI、会话票据存储。
 * 纯函数：无 I/O。
 */

import type {
PairingChallengePayload,
PairingConfirmedPayload,
PairingRequestPayload
} from "../../../messages/payloads/core.js";
import { PROTOCOL_VERSION } from "../../../protocol-version.js";
import {
expectDateTime,
expectNonEmptyString,
expectObject,
expectStringArray,
rejectUnknownKeys
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

export { validatePairingCompletedPayload,validatePairingDesktopApprovedPayload,validatePairingRevokedPayload } from "./decision.js";
