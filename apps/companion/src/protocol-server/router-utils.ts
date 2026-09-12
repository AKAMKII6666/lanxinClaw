/**
 * protocol router 共享工具。
 *
 * 职责：出站 party 解析、WS JSON 发送。
 * 不拥有：业务 handler、backend 写入。
 * 纯函数/轻量副作用。
 */

import type { WebSocket } from "ws";
import type { OutboundParty } from "./outbound-envelopes.js";
import type { HandleProtocolSocketMessageInput } from "./router.js";

/**
 * 解析出站 party；无 phone 时不广播。
 *
 * @param input 入参
 * @returns party 或 null
 */
export function resolveOutboundParty(input: HandleProtocolSocketMessageInput): OutboundParty | null {
  const phoneDeviceId = input.options.backend.getState().connection.phoneDeviceId;
  if (!phoneDeviceId) {
    return null;
  }
  return {
    desktopDeviceId: input.options.pairing.desktopDeviceId,
    phoneDeviceId,
  };
}

/**
 * 发送 JSON 到 socket。
 *
 * @param socket WebSocket
 * @param body 载荷
 */
export function sendJson(socket: WebSocket, body: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(body));
  }
}
