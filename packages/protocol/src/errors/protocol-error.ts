/**
 * 协议层错误对象与工厂。
 *
 * 职责：定义 wire / validator 共用的 `ProtocolError` 形状，并提供稳定错误工厂。
 * 不拥有：HTTP 状态映射、companion 审计落盘、凭据脱敏策略之外的日志。
 * 纯函数：工厂只构造对象，不抛出、不 I/O。
 */

/**
 * 协议错误：可经 wire 返回，不得含 stack、secret 或 API key。
 */
export interface ProtocolError {
  /** 稳定错误码，供客户端分支 */
  code: string;
  /** 人类可读说明；不得含凭据或私钥 */
  message: string;
  /** 调用方是否可按幂等策略安全重试 */
  retryable: boolean;
  /** 可选结构化细节；不得含 secret */
  details?: Record<string, unknown>;
}

/**
 * 构造协议错误对象。
 *
 * @param code 稳定错误码
 * @param message 不含凭据的说明
 * @param retryable 是否可重试
 * @param details 可选细节
 * @returns 可序列化的 ProtocolError
 */
export function createProtocolError(
  code: string,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): ProtocolError {
  const error: ProtocolError = { code, message, retryable };
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

/**
 * 校验失败时的标准错误。
 *
 * @param message 失败原因摘要
 * @param details 可选字段级细节
 * @returns retryable=false 的 validation_failed 错误
 */
export function validationFailed(message: string, details?: Record<string, unknown>): ProtocolError {
  return createProtocolError("validation_failed", message, false, details);
}

/**
 * 未知 message type 时的标准错误。
 *
 * @param type 收到的 type 字符串
 * @returns 不可重试错误；调用方应拒绝或安全忽略
 */
export function unknownMessageType(type: string): ProtocolError {
  return createProtocolError("unknown_message_type", `未知 message type: ${type}`, false, { type });
}
