/** 分离职责的协议校验；纯函数，无 I/O 或状态提交。 */
import {
type AffairPayload
} from "../../../messages/payloads/core.js";
import { AFFAIR_STATUSES } from "../../../states/affair-status.js";
import {
expectEnum,
expectNonEmptyString,
expectObject,
expectStringArray,
rejectUnknownKeys
} from "../../primitives.js";
import type { ValidateResult } from "../../result.js";
import { assignOptionalStringOrNull } from "./job/fields.js";


const AFFAIR_KEYS = [
  "affairId",
  "title",
  "ownerAgent",
  "status",
  "context",
  "acceptanceCriteria",
  "blockedReason",
  "resumeCondition",
  "currentJobId",
] as const;

/**
 * 校验 AffairPayload。
 *
 * @param value 待检 payload
 * @returns AffairPayload 或失败
 */
export function validateAffairPayload(value: unknown): ValidateResult<AffairPayload> {
  const obj = expectObject(value, "affair.payload");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, AFFAIR_KEYS, "affair.payload");
  if (!keys.ok) {
    return keys;
  }
  const affairId = expectNonEmptyString(obj.value.affairId, "affairId");
  if (!affairId.ok) {
    return affairId;
  }
  const title = expectNonEmptyString(obj.value.title, "title");
  if (!title.ok) {
    return title;
  }
  const ownerAgent = expectEnum(obj.value.ownerAgent, "ownerAgent", ["zhang-boss"] as const);
  if (!ownerAgent.ok) {
    return ownerAgent;
  }
  const status = expectEnum(obj.value.status, "status", AFFAIR_STATUSES);
  if (!status.ok) {
    return status;
  }
  const context = expectStringArray(obj.value.context, "context");
  if (!context.ok) {
    return context;
  }
  const acceptanceCriteria = expectStringArray(obj.value.acceptanceCriteria, "acceptanceCriteria");
  if (!acceptanceCriteria.ok) {
    return acceptanceCriteria;
  }
  const payload: AffairPayload = {
    affairId: affairId.value,
    title: title.value,
    ownerAgent: ownerAgent.value,
    status: status.value,
    context: context.value,
    acceptanceCriteria: acceptanceCriteria.value,
  };
  for (const key of ["blockedReason", "resumeCondition", "currentJobId"] as const) {
    const err = assignOptionalStringOrNull(obj.value, key, payload);
    if (err) {
      return err;
    }
  }
  return { ok: true, value: payload };
}
