/**
 * Runtime 错误归一化。
 *
 * 职责：保留 OpenClaw/Gateway 的结构化错误码与 retryable 证据。
 * 不拥有：日志、协议广播、job 状态迁移。
 * 纯函数：无 I/O。
 */

/** runtime 调用失败的归一化结果。 */
export interface RuntimeErrorResult {
  /** 稳定错误码。 */
  code: string;
  /** 用户可见安全摘要。 */
  message: string;
  /** 是否可安全重试。 */
  retryable: boolean;
}

/**
 * 把 runtime 抛出的错误归一为 adapter result。
 *
 * @param err 捕获到的错误
 * @param fallbackCode 无结构化 code 时的兜底 code
 * @param fallbackMessage 无 message 时的兜底消息
 * @returns 归一化错误
 */
export function runtimeErrorResult(
  err: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): RuntimeErrorResult {
  if (err && typeof err === "object") {
    const typed = err as { code?: unknown; message?: unknown; retryable?: unknown };
    const code = safeErrorCode(typed.code);
    if (code) {
      return {
        code,
        message: safeErrorMessage(typed.message, fallbackMessage),
        retryable: retryableForCode(code, typed.retryable),
      };
    }
  }
  const message = err instanceof Error ? err.message : fallbackMessage;
  if (message.startsWith("gateway_")) {
    return {
      code: message,
      message: safeErrorMessage(message, fallbackMessage),
      retryable: isRetryableGatewayCode(message),
    };
  }
  return { code: fallbackCode, message: safeErrorMessage(message, fallbackMessage), retryable: true };
}

function safeErrorCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const code = value.trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : null;
}

function safeErrorMessage(value: unknown, fallbackMessage: string): string {
  const text = typeof value === "string" && value.trim() ? value : fallbackMessage;
  return redactSensitiveText(text.replace(/\s+/g, " ").trim()).slice(0, 800);
}

function retryableForCode(code: string, value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return code.startsWith("gateway_") ? isRetryableGatewayCode(code) : false;
}

function isRetryableGatewayCode(code: string): boolean {
  return ![
    "gateway_url_missing",
    "gateway_agent_missing",
    "gateway_scope_missing",
    "gateway_auth_missing",
    "gateway_connect_rejected",
    "gateway_invalid_run",
    "gateway_run_not_found",
  ].includes(code);
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer ***")
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[A-Za-z0-9._-]{8,}/gi, "$1***");
}
