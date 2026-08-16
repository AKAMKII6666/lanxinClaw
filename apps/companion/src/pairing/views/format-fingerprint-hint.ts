/**
 * 将原始指纹材料截断为 UI 安全提示。
 *
 * 职责：避免把完整密钥或 pairingSecret 送进 renderer。
 * 不拥有：身份持久化、会话认证。
 * 纯函数：无 I/O。
 */

/**
 * 生成截断指纹提示（形如 `8F:2A:…`）。
 *
 * @param raw 原始指纹或设备指纹材料；不得传入 pairingSecret
 * @returns 短提示；材料过短时返回「未知指纹」
 */
export function formatFingerprintHint(raw: string): string {
  const cleaned = raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (cleaned.length < 4) {
    return "未知指纹";
  }
  const a = cleaned.slice(0, 2);
  const b = cleaned.slice(2, 4);
  return `${a}:${b}:…`;
}
