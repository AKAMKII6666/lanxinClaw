/**
 * 用户可见文本脱敏。
 *
 * 职责：压缩空白并遮蔽常见凭据形态。
 * 不拥有：业务证据分类、状态裁决。
 * 纯函数：不修改入参。
 */

/**
 * 清理用户可见文本。
 *
 * @param value 原始文本
 * @returns 压缩空白并脱敏后的文本
 */
export function safeText(value: string | null | undefined): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer ***")
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "jwt-***")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***")
    .replace(/(postgres(?:ql)?|mysql|mongodb):\/\/[^\s]+/gi, "$1://***")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[PRIVATE_KEY]")
    .slice(0, 800);
}
