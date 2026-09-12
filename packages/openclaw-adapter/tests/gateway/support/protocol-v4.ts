/** Gateway 协议测试服务器；仅用于本机随机端口测试。 */
import { WebSocketServer } from "ws";
import {
GatewayTransportError
} from "../../../src/index.js";


/**
 * 启动模拟协议 v4 的 Gateway server。
 */
export async function startProtocolV4Server(
  handler: (frame: Record<string, unknown>) => unknown,
): Promise<{ url: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: `nonce-${Date.now()}` },
    }));
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type !== "req") {
        return;
      }
      try {
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: handler(frame),
        }));
      } catch (err) {
        const error = err instanceof GatewayTransportError
          ? { code: err.code, message: err.message, retryable: err.retryable }
          : { code: "gateway_test_error", message: "test error", retryable: false };
        socket.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error }));
      }
    });
  });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const address = wss.address();
  if (address === null || typeof address === "string") {
    throw new Error("test_ws_bind_failed");
  }
  return {
    url: `ws://127.0.0.1:${address.port}`,
    close: async () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
