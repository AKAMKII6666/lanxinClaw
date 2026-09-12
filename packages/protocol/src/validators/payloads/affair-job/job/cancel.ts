/** 分离职责的协议校验；纯函数，无 I/O 或状态提交。 */
import {
expectNonEmptyString,
expectObject,
rejectUnknownKeys
} from "../../../primitives.js";
import type { ValidateResult } from "../../../result.js";


const JOB_CANCEL_KEYS = ["jobId", "affairId"] as const;

/**
 * 校验 job.cancel 载荷：至少 jobId 与 affairId（与协议消息目录对齐）。
 *
 * @param value 待检 payload
 * @returns 取消载荷或失败
 */
export function validateJobCancelPayload(
  value: unknown,
): ValidateResult<{ jobId: string; affairId: string }> {
  const obj = expectObject(value, "job.cancel.payload");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(obj.value, JOB_CANCEL_KEYS, "job.cancel.payload");
  if (!keys.ok) {
    return keys;
  }
  const jobId = expectNonEmptyString(obj.value.jobId, "jobId");
  if (!jobId.ok) {
    return jobId;
  }
  const affairId = expectNonEmptyString(obj.value.affairId, "affairId");
  if (!affairId.ok) {
    return affairId;
  }
  return { ok: true, value: { jobId: jobId.value, affairId: affairId.value } };
}
