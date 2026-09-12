/** 分离职责的协议校验；纯函数，无 I/O 或状态提交。 */
import type {
PairingCompletedPayload,
PairingDesktopApprovedPayload,
PairingRevokedPayload
} from "../../../messages/payloads/core.js";
import {
expectDateTime,
expectNonEmptyString,
expectObject,
expectStringOrNull,
optionalField,
rejectUnknownKeys
} from "../../primitives.js";
import type { ValidateResult } from "../../result.js";


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
    ["pairingId", "phoneDeviceId", "desktopDeviceId", "pairingSecret", "pairedAt"],
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
  const pairingSecret = expectNonEmptyString(obj.value.pairingSecret, "pairingSecret");
  if (!pairingSecret.ok) {
    return pairingSecret;
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
      pairingSecret: pairingSecret.value,
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
