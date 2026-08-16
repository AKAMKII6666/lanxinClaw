/**
 * permission.decision 校验。
 *
 * 职责：校验 permission.decision 载荷。
 * 不拥有：权限最终授予（companion UI）。
 * 纯函数：无 I/O。
 */

import type { PermissionDecisionPayload } from "../../../messages/payloads/session.js";
import { PERMISSION_DECISIONS } from "../../../states/permission/decision.js";
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
 * 校验 permission.decision。
 *
 * @param value 待检 payload
 * @returns PermissionDecisionPayload 或失败
 */
export function validatePermissionDecisionPayload(
  value: unknown,
): ValidateResult<PermissionDecisionPayload> {
  const obj = expectObject(value, "permission.decision");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["permissionRequestId", "jobId", "decision", "decidedAt", "note"],
    "permission.decision",
  );
  if (!keys.ok) {
    return keys;
  }
  const permissionRequestId = expectNonEmptyString(
    obj.value.permissionRequestId,
    "permissionRequestId",
  );
  if (!permissionRequestId.ok) {
    return permissionRequestId;
  }
  const decision = expectEnum(obj.value.decision, "decision", PERMISSION_DECISIONS);
  if (!decision.ok) {
    return decision;
  }
  const decidedAt = expectDateTime(obj.value.decidedAt, "decidedAt");
  if (!decidedAt.ok) {
    return decidedAt;
  }
  const jobId = optionalField(obj.value, "jobId", (v) => expectStringOrNull(v, "jobId"));
  if (!jobId.ok) {
    return jobId;
  }
  const note = optionalField(obj.value, "note", (v) => expectStringOrNull(v, "note"));
  if (!note.ok) {
    return note;
  }
  const payload: PermissionDecisionPayload = {
    permissionRequestId: permissionRequestId.value,
    decision: decision.value,
    decidedAt: decidedAt.value,
  };
  if (jobId.value !== undefined) {
    payload.jobId = jobId.value;
  }
  if (note.value !== undefined) {
    payload.note = note.value;
  }
  return { ok: true, value: payload };
}
