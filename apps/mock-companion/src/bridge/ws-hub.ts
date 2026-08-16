/**
 * WebSocket hub：协议双向通道。
 *
 * 职责：接受 WS 连接、解析 JSON envelope、广播出站事件。
 * 不拥有：HTTP UI 契约、配对策略本身（交给 router）。
 * 副作用：维护连接集合；收发网络帧；更新 store（经 router）。
 */

import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { MockCompanionConfig } from "../config.js";
import type { MemoryStore } from "../store/memory-store.js";
import { appendEvent } from "../store/memory-store.js";
import {
  buildErrorBody,
  peekSourceDeviceId,
  routeInboundMessage,
} from "./message-router.js";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";

/**
 * WS hub 句柄。
 */
export interface WsHub {
  /** 向所有已连接客户端广播 */
  broadcast: (envelope: ProtocolEnvelope<any>) => void;
  /** 关闭 hub */
  close: () => Promise<void>;
}

/**
 * 将 envelope 安全序列化后发送。
 *
 * @param socket 客户端
 * @param body 可序列化对象
 */
function sendJson(socket: WebSocket, body: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(body));
  }
}

/**
 * 挂载 WebSocket 服务到 HTTP server 的 `/ws` 路径。
 *
 * @param httpServer HTTP 服务
 * @param store 内存 store
 * @param config 配置
 * @returns hub 句柄
 */
export function attachWsHub(
  httpServer: HttpServer,
  store: MemoryStore,
  config: MockCompanionConfig,
): WsHub {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();

  const broadcast = (envelope: ProtocolEnvelope<any>): void => {
    appendEvent(store, envelope);
    const text = JSON.stringify(envelope);
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(text);
      }
    }
  };

  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString()) as unknown;
      } catch {
        sendJson(socket, {
          ok: false,
          error: { code: "invalid_json", message: "WS 帧不是合法 JSON", retryable: false },
        });
        return;
      }
      const result = routeInboundMessage(store, config, raw, broadcast);
      if (!result.ok) {
        sendJson(
          socket,
          buildErrorBody(config, peekSourceDeviceId(raw), result.error),
        );
      }
    });
    socket.on("close", () => {
      clients.delete(socket);
    });
  });

  return {
    broadcast,
    close: async () => {
      for (const client of clients) {
        client.close();
      }
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}
