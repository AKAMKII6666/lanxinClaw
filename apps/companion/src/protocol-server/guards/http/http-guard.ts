/**
 * HTTP 回环判断：未配对网络不得暴露 snapshot。
 *
 * 职责：识别 loopback 地址，供 /snapshot 门闩使用。
 * 不拥有：WS 认证、权限、OpenClaw。
 * 纯函数：无 I/O。
 */

/**
 * 是否为本机回环地址。
 *
 * @param address 远端地址
 * @returns 是回环则为 true
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === ":ffff:127.0.0.1" ||
    address === "::ffff:127.0.0.1"
  );
}
