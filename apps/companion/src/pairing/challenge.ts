/**
 * Pairing challenge 生成与应答校验。
 *
 * 职责：为 pairing.challenge 生成一次性随机串，并校验 challengeResponse。
 * 不拥有：身份持久化（见 credentials/identity-store）、桌面 UI、长期 pairingSecret 托管。
 * 副作用：读取系统 CSPRNG；无网络、无磁盘。
 */

import { randomBytes } from "node:crypto";

/**
 * 生成 pairing challenge（非长期凭据）。
 *
 * @param byteLength 随机字节数，默认 24
 * @returns hex 挑战串
 */
export function createPairingChallenge(byteLength = 24): string {
  return randomBytes(byteLength).toString("hex");
}

/**
 * 校验电话侧 challengeResponse。
 *
 * @param expected 发出的 challenge
 * @param response 电话回传的 challengeResponse
 * @returns 是否一致（MVP：精确相等；后续可换成 proof-of-possession）
 */
export function verifyChallengeResponse(expected: string, response: string): boolean {
  return expected.length > 0 && expected === response;
}
