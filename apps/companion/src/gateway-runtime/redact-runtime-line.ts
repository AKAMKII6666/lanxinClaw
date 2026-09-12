/**
 * OpenClaw 子进程 stdout/stderr 行级脱敏。
 *
 * 职责：日志落盘前清洗密钥形态字符串。
 * 不拥有：pino、进程管理。
 * 纯函数。
 */

/**
 * 脱敏一行运行时日志（不得保留 API key / Bearer / token 明文）。
 *
 * @param line 原始行
 * @returns 脱敏后文本
 */
export function redactOpenClawRuntimeLine(line: string): string {
  return String(line || "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***")
    .replace(
      /((?:api[_-]?key|token|secret|password|authProof|pairingSecret|credential|BRAVE_API_KEY|LANXIN_OPENCLAW_API_KEY)\s*[:=]\s*)[^\s,;"}]+/gi,
      "$1***",
    )
    .replace(/([?&](?:token|api[_-]?key)=)[^&\s]+/gi, "$1***");
}
