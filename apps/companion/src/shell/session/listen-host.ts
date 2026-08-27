/**
 * 协议监听地址偏好（本机回环 vs 局域网）。
 *
 * 职责：解析 127.0.0.1 / 0.0.0.0，供下次启动绑定。
 * 不拥有：实际 listen、防火墙。
 * 纯函数：无 I/O。
 */

/** 允许的监听 host */
export type ProtocolListenHost = "127.0.0.1" | "0.0.0.0";

/**
 * 解析监听 host；非法值回落到回环。
 *
 * @param raw 原始字符串
 * @returns 合法 host
 */
export function parseProtocolListenHost(raw: string | undefined | null): ProtocolListenHost {
  return raw === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
}
