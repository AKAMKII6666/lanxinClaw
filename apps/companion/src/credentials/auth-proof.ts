/**
 * session.open authProof 的生成与校验。
 *
 * 职责：用配对共享秘密证明重连方持有已配对 identity。
 * 不拥有：identity 持久化、pairing 状态机、权限授予。
 * 副作用：使用 Node crypto HMAC；无磁盘、无网络。
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 生成新的配对共享秘密（仅在 pairing.completed 时创建一次）。
 *
 * @param byteLength 随机字节数，默认 32
 * @returns hex 秘密；不得写入日志
 */
export function createPairingSecret(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

/**
 * 为 session.open 构造 authProof。
 *
 * @param pairingSecret 本地保存的配对秘密
 * @param sessionId 本次 session id
 * @returns hex HMAC；证明持有秘密且绑定 sessionId
 */
export function createSessionAuthProof(pairingSecret: string, sessionId: string): string {
  return createHmac("sha256", pairingSecret)
    .update(`session.open:v1:${sessionId}`, "utf8")
    .digest("hex");
}

/**
 * 常量时间比较两个 hex/字符串证明。
 *
 * @param expected 期望证明
 * @param actual 入站证明
 * @returns 是否一致
 */
function safeEqualHex(expected: string, actual: string): boolean {
  if (expected.length === 0 || expected.length !== actual.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(actual, "utf8"));
  } catch {
    return false;
  }
}

/**
 * 校验 session.open 的 authProof。
 *
 * @param pairingSecret 已存配对秘密；revoked/缺失时调用方应先拒绝
 * @param sessionId 入站 sessionId
 * @param authProof 入站证明
 * @returns 是否通过；失败不得因 IP/端口放行
 */
export function verifySessionAuthProof(
  pairingSecret: string,
  sessionId: string,
  authProof: string,
): boolean {
  if (!pairingSecret || !sessionId || !authProof) {
    return false;
  }
  const expected = createSessionAuthProof(pairingSecret, sessionId);
  return safeEqualHex(expected, authProof);
}
