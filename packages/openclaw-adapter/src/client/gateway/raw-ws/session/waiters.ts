/** 职责：等待连接与握手事件。不拥有：job 映射或权限。副作用：注册并释放 socket 等待器。 */
import WebSocket from "ws";
import {
GatewayTransportError
} from "../../transport.js";
import { parseFrame } from "../framing/rpc.js";


/**
 * 等待 socket open。
 *
 * @param ws socket
 * @param timeoutMs 超时
 * @returns 完成
 */
export function waitSocketOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new GatewayTransportError("gateway_connect_timeout", "Gateway 连接超时", true));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
    };
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(new GatewayTransportError("gateway_connect_failed", err.message, true));
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });
}

/**
 * 从队列或后续消息中取匹配帧。
 *
 * @param ws socket
 * @param queue 常驻消息队列
 * @param predicate 匹配条件
 * @param timeoutMs 超时
 * @param label 描述
 * @returns 匹配帧
 */
export function takeGatewayEvent(
  ws: WebSocket,
  queue: Array<Record<string, unknown>>,
  predicate: (frame: Record<string, unknown>) => boolean,
  timeoutMs: number,
  label: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    let onMessage: (data: WebSocket.RawData) => void = () => undefined;
    let onError: (err: Error) => void = () => undefined;
    let onClose: () => void = () => undefined;
    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const check = (): boolean => {
      const index = queue.findIndex(predicate);
      if (index >= 0) {
        const frame = queue.splice(index, 1)[0];
        if (frame) {
          cleanup();
          resolve(frame);
          return true;
        }
      }
      return false;
    };
    if (check()) {
      return;
    }
    timer = setTimeout(() => {
      cleanup();
      reject(new GatewayTransportError("gateway_event_timeout", `等待事件 ${label} 超时`, true));
    }, timeoutMs);
    onMessage = (data: WebSocket.RawData): void => {
      queue.push(parseFrame(data));
      check();
    };
    onError = (err: Error): void => {
      cleanup();
      reject(new GatewayTransportError("gateway_socket_error", err.message, true));
    };
    onClose = (): void => {
      cleanup();
      reject(new GatewayTransportError("gateway_socket_closed", "Gateway 连接提前关闭", true));
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}
