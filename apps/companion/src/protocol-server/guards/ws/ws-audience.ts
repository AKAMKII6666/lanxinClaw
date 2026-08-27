/**
 * WS 出站受众：未认证 socket 不得收到业务 envelope。
 *
 * 职责：按 message type 决定 pairing/session 握手可见、业务仅已认证。
 * 不拥有：socket 生命周期、权限裁决。
 * 纯函数：无 I/O。
 */

/**
 * 是否为配对/会话握手消息（未认证 socket 可收）。
 *
 * @param type envelope type
 * @returns 是否握手类
 */
export function isPreSessionProtocolType(type: string): boolean {
  return type.startsWith("pairing.") || type.startsWith("session.");
}

/**
 * 未认证 socket 是否应收到该 envelope。
 *
 * @param type envelope type
 * @param socketAuthenticated 该 socket 是否已 session.accepted
 * @returns 是否发送
 */
export function shouldSendEnvelopeToSocket(type: string, socketAuthenticated: boolean): boolean {
  if (isPreSessionProtocolType(type)) {
    return true;
  }
  return socketAuthenticated;
}
