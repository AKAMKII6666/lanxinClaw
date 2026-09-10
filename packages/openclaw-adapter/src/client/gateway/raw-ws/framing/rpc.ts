/** 职责：RPC 请求关联、帧解析与错误归一化。不拥有：job 裁决。副作用：WebSocket 发送与等待。 */
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
GatewayTransportError
} from "../../transport.js";


/**
 * 发送 req 并等待 res。
 *
 * @param ws socket
 * @param method 方法名
 * @param params 参数
 * @param timeoutMs 超时
 * @returns 响应 payload
 */
export async function rpc(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const id = `gw_${randomUUID()}`;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new GatewayTransportError("gateway_timeout", `Gateway RPC 超时: ${method}`, true));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onMessage = (data: WebSocket.RawData): void => {
      const frame = parseFrame(data);
      if (frame.type !== "res" || frame.id !== id) {
        return;
      }
      cleanup();
      if (frame.ok === false) {
        reject(errorFromFrame(frame));
        return;
      }
      const payload = frame.payload;
      resolve(
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {},
      );
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(new GatewayTransportError("gateway_socket_error", err.message, true));
    };
    const onClose = (): void => {
      cleanup();
      reject(new GatewayTransportError("gateway_socket_closed", "Gateway 连接提前关闭", true));
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
    try { ws.send(JSON.stringify({ type: "req", id, method, params })); }
    catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
  });
}

/**
 * 解析 Gateway 帧。
 *
 * @param data 原始数据
 * @returns 帧
 */
export function parseFrame(data: WebSocket.RawData): Record<string, unknown> {
  try {
    const value = JSON.parse(data.toString()) as unknown;
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 从错误帧构造错误。
 *
 * @param frame 响应帧
 * @returns 错误
 */
function errorFromFrame(frame: Record<string, unknown>): GatewayTransportError {
  const error = frame.error;
  if (error && typeof error === "object") {
    const typed = error as { code?: unknown; message?: unknown; retryable?: unknown };
    return new GatewayTransportError(
      typeof typed.code === "string" ? typed.code : "gateway_rpc_failed",
      typeof typed.message === "string" ? typed.message : "Gateway RPC 失败",
      typeof typed.retryable === "boolean" ? typed.retryable : false,
    );
  }
  return new GatewayTransportError("gateway_rpc_failed", "Gateway RPC 失败", false);
}
