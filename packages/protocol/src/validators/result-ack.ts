/**
 * 请求结果回执校验。
 * 职责：拒绝未关联和不完整结果；不拥有 socket 身份、持久化与重试。纯函数。
 */
import { PROTOCOL_VERSION } from "../protocol-version.js";
import type { ProtocolResultAck } from "../messages/result-ack.js";
import type { ValidateResult } from "./result.js";
import { validateAffairActionResult } from "./payloads/affair-job/action-result.js";

/**
 * 校验完整回执，成功关闭结果必须包含合法事务和同事务子任务。
 * @param value 不可信 JSON
 * @returns 通过校验的回执或稳定错误
 */
export function validateProtocolResultAck(value: unknown): ValidateResult<ProtocolResultAck> {
  const fail = (): ValidateResult<ProtocolResultAck> => ({ ok: false, error: {
    code: "invalid_result_ack", message: "请求结果缺少有效关联或业务事实", retryable: false,
  } });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const ack = value as Record<string, unknown>;
  if (ack.protocolVersion !== PROTOCOL_VERSION || typeof ack.ok !== "boolean") return fail();
  const allowed = ack.ok
    ? ["protocolVersion", "ok", "correlationId", "acceptedType", "duplicate", "result"]
    : ["protocolVersion", "ok", "correlationId", "rejectedType", "error"];
  if (Object.keys(ack).some((key) => !allowed.includes(key))) return fail();
  if (!(ack.ok ? hasSuccessEvidence(ack) : hasFailureDetails(ack))) return fail();
  return { ok: true, value: ack as unknown as ProtocolResultAck };
}

function text(input: unknown): input is string { return typeof input === "string" && input.trim().length > 0; }

function hasSuccessEvidence(ack: Record<string, unknown>): boolean {
  if (!text(ack.correlationId) || !text(ack.acceptedType)) return false;
  if (ack.duplicate !== undefined && typeof ack.duplicate !== "boolean") return false;
  if (ack.acceptedType === "affair.close" && !ack.result) return false;
  return ack.result === undefined || validateAffairActionResult(ack.result).ok;
}

function hasFailureDetails(ack: Record<string, unknown>): boolean {
  if (ack.correlationId !== null && !text(ack.correlationId)) return false;
  if (ack.rejectedType !== null && !text(ack.rejectedType)) return false;
  if (!ack.error || typeof ack.error !== "object" || Array.isArray(ack.error)) return false;
  const error = ack.error as Record<string, unknown>;
  return text(error.code) && text(error.message) && typeof error.retryable === "boolean";
}
