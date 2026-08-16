/**
 * 桌面 companion 电话协议服务。
 *
 * 职责：监听本机 HTTP/WS 端口，并把 phone envelope 交给 backend router。
 * 不拥有：renderer、OpenClaw core、phone 主仓。
 * 副作用：监听 TCP 端口；广播协议消息。
 */

import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { PairingLifecycleDeps } from "../pairing/lifecycle.js";
import type { PairingSession } from "../pairing/session.js";
import type { DeviceIdentityStore } from "../credentials/identity-store.js";
import type { CompanionBackendRuntime } from "../backend/runtime.js";
import {
  approvePendingPairing,
  handleProtocolSocketMessage,
} from "./router.js";

/**
 * Server 选项。
 */
export interface CompanionProtocolServerOptions {
  /** 监听端口；0 表示随机端口 */
  port?: number;
  /** 监听 host；默认 127.0.0.1 */
  host?: string;
  /** backend runtime */
  backend: CompanionBackendRuntime;
  /** identity store */
  identityStore: DeviceIdentityStore;
  /** pairing 依赖 */
  pairing: PairingLifecycleDeps;
}

/**
 * Server 句柄。
 */
export interface CompanionProtocolServerHandle {
  /** HTTP base URL */
  baseUrl: string;
  /** WebSocket URL */
  wsUrl: string;
  /** 桌面批准当前 pairing */
  approvePairing: (pairingId: string) => Promise<void>;
  /** 关闭 server */
  close: () => Promise<void>;
}

/**
 * 启动 companion protocol server。
 *
 * @param options 选项
 * @returns server 句柄
 */
export async function startCompanionProtocolServer(
  options: CompanionProtocolServerOptions,
): Promise<CompanionProtocolServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const clients = new Set<WebSocket>();
  let pendingPairing: PairingSession | null = null;
  const httpServer = createProtocolHttpServer(options);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const broadcast = createBroadcast(options, clients);
  let closed = false;

  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.on("message", (data) => {
      void handleProtocolSocketMessage({
        options,
        text: data.toString(),
        broadcast,
        socket,
        getPending: () => pendingPairing,
        setPending: (session) => {
          pendingPairing = session;
        },
      });
    });
    socket.on("close", () => {
      clients.delete(socket);
    });
  });

  await listen(httpServer, options.port ?? 0, host);
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("companion_protocol_bind_failed");
  }
  return {
    baseUrl: `http://${host}:${address.port}`,
    wsUrl: `ws://${host}:${address.port}/ws`,
    approvePairing: (pairingId) =>
      approvePendingPairing(options, pendingPairing, pairingId, broadcast),
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await closeServer(httpServer, wss, clients);
    },
  };
}

/**
 * 创建 HTTP server。
 *
 * @param options 选项
 * @returns HTTP server
 */
function createProtocolHttpServer(options: CompanionProtocolServerOptions): HttpServer {
  return createServer((req, res) => {
    if (req.url === "/health") {
      writeJson(res, 200, { ok: true, service: "lanxin-companion-protocol" });
      return;
    }
    if (req.url === "/snapshot") {
      writeJson(res, 200, options.backend.getSnapshot());
      return;
    }
    writeJson(res, 404, { ok: false, error: { code: "not_found", message: "未知 endpoint" } });
  });
}

/**
 * 创建广播函数。
 *
 * @param options 选项
 * @param clients 客户端集合
 * @returns 广播函数
 */
function createBroadcast(
  options: CompanionProtocolServerOptions,
  clients: Set<WebSocket>,
): (envelope: ProtocolEnvelope) => void {
  return (envelope) => {
    options.backend.applyProtocolEnvelope(envelope);
    const text = JSON.stringify(envelope);
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(text);
      }
    }
  };
}

/**
 * 监听端口。
 */
async function listen(server: HttpServer, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}

/**
 * 关闭 server。
 */
async function closeServer(
  httpServer: HttpServer,
  wss: WebSocketServer,
  clients: Set<WebSocket>,
): Promise<void> {
  for (const client of clients) {
    client.terminate();
  }
  clients.clear();
  for (const client of wss.clients) {
    client.terminate();
  }
  await new Promise<void>((resolve, reject) => {
    wss.close((err) => {
      if (!err || err.message === "The server is not running") {
        resolve();
        return;
      }
      reject(err);
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => {
      if (!err || (err as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(err);
    });
  });
}

/**
 * 写 HTTP JSON。
 */
function writeJson(
  res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
