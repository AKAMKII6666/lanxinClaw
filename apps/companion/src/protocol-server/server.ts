/**
 * 桌面 companion 电话协议服务。
 *
 * 职责：监听本机 HTTP/WS 端口，并把 phone envelope 交给 backend router。
 * 不拥有：renderer、OpenClaw core、phone 主仓。
 * 副作用：监听 TCP 端口；广播协议消息。
 */

import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createEnvelope, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { PairingLifecycleDeps } from "../pairing/lifecycle.js";
import type { PairingSession } from "../pairing/session.js";
import type { DeviceIdentityStore } from "../credentials/identity-store.js";
import type { CompanionBackendRuntime } from "../backend/runtime.js";
import type { ApplyProtocolResult } from "../state/types.js";
import {
  approvePendingPairing,
  handleProtocolSocketMessage,
} from "./router.js";
import { isLoopbackAddress } from "./guards/http/http-guard.js";
import { shouldSendEnvelopeToSocket } from "./guards/ws/ws-audience.js";

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
  /** 心跳间隔毫秒；缺省 5000（与 session.accepted 广播一致） */
  heartbeatIntervalMs?: number;
  /** 连续错过多少次心跳判定超时；缺省 3 */
  missedHeartbeats?: number;
  /** job.cancel 处理器（真正取消 OpenClaw run）；缺省仅状态闭环 */
  onJobCancel?: (input: { jobId: string; affairId: string }) => Promise<void>;
  /** session.accepted 之后回调（flush pending context） */
  onSessionAccepted?: () => void;
}

/**
 * Server 句柄。
 */
export interface CompanionProtocolServerHandle {
  /** HTTP base URL */
  baseUrl: string;
  /** WebSocket URL */
  wsUrl: string;
  /** 实际监听端口 */
  port: number;
  /** 广播协议 envelope（先 apply backend，再发客户端）；apply 失败时不 send */
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult;
  /** 仅 WS 发送（假定 backend 已 apply） */
  sendEnvelope: (envelope: ProtocolEnvelope) => void;
  /** session.open 成功时替换为单活 authenticated socket */
  replaceAuthenticatedSocket: (socket: WebSocket) => void;
  /** 清除全部已认证 socket（配对撤销/会话关闭） */
  clearAuthenticatedSockets: () => void;
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
  const authenticatedSockets = new Set<WebSocket>();
  let pendingPairing: PairingSession | null = null;
  const httpServer = createProtocolHttpServer(options);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const { broadcast, sendEnvelope } = createProtocolBroadcaster(options, clients, authenticatedSockets);
  let closed = false;
  const heartbeatTimer = startHeartbeatMonitor(options, broadcast, authenticatedSockets);

  const replaceAuthenticatedSocket = (socket: WebSocket): void => {
    for (const old of authenticatedSockets) {
      if (old !== socket && old.readyState === old.OPEN) {
        old.terminate();
      }
    }
    authenticatedSockets.clear();
    authenticatedSockets.add(socket);
  };

  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.on("message", (data) => {
      void handleProtocolSocketMessage({
        options,
        text: data.toString(),
        broadcast,
        sendEnvelope,
        socket,
        getPending: () => pendingPairing,
        setPending: (session) => {
          pendingPairing = session;
        },
        markSocketAuthenticated: (authenticated) => {
          replaceAuthenticatedSocket(authenticated);
        },
        isSocketAuthenticated: () => authenticatedSockets.has(socket),
      });
    });
    socket.on("close", () => {
      clients.delete(socket);
      authenticatedSockets.delete(socket);
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
    port: address.port,
    broadcast,
    sendEnvelope,
    replaceAuthenticatedSocket,
    clearAuthenticatedSockets: () => {
      authenticatedSockets.clear();
    },
    approvePairing: (pairingId) =>
      approvePendingPairing(options, pendingPairing, pairingId, broadcast),
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeatTimer);
      await closeServer(httpServer, wss, clients);
    },
  };
}

/**
 * 启动心跳监督：连续 missedHeartbeats 个周期未收到 heartbeat 则标记失联。
 *
 * @param options 服务选项
 * @param broadcast 广播（超时时发 session.closed）
 * @returns 定时器
 */
function startHeartbeatMonitor(
  options: CompanionProtocolServerOptions,
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult,
  authenticatedSockets: Set<WebSocket>,
): NodeJS.Timeout {
  const intervalMs = options.heartbeatIntervalMs ?? 5_000;
  const missed = options.missedHeartbeats ?? 3;
  const thresholdMs = intervalMs * missed;
  const timer = setInterval(() => {
    const connection = options.backend.getState().connection;
    if (!connection.sessionAuthenticated || !connection.lastSeenAt) {
      return;
    }
    const lastSeenMs = Date.parse(connection.lastSeenAt);
    if (!Number.isFinite(lastSeenMs)) {
      return;
    }
    if (Date.now() - lastSeenMs <= thresholdMs) {
      return;
    }
    options.backend.markConnectionLost();
    authenticatedSockets.clear();
    if (connection.phoneDeviceId) {
      broadcast(
        createEnvelope({
          source: { kind: "companion", deviceId: options.pairing.desktopDeviceId },
          target: { kind: "phone", deviceId: connection.phoneDeviceId },
          type: "session.closed",
          payload: {
            sessionId: connection.sessionId ?? "",
            reason: "heartbeat_timeout",
            closedAt: new Date().toISOString(),
          },
        }),
      );
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
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
      const remote = req.socket.remoteAddress;
      if (!isLoopbackAddress(remote)) {
        writeJson(res, 403, { ok: false, error: { code: "snapshot_loopback_only", message: "snapshot 仅本机回环可访问" } });
        return;
      }
      writeJson(res, 200, options.backend.getSnapshot());
      return;
    }
    writeJson(res, 404, { ok: false, error: { code: "not_found", message: "未知 endpoint" } });
  });
}

/**
 * 创建广播与纯发送函数。
 *
 * @param options 选项
 * @param clients 客户端集合
 * @returns broadcast（apply+send）与 sendEnvelope（仅 send）
 */
function createProtocolBroadcaster(
  options: CompanionProtocolServerOptions,
  clients: Set<WebSocket>,
  authenticatedSockets: Set<WebSocket>,
): {
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult;
  sendEnvelope: (envelope: ProtocolEnvelope) => void;
} {
  const sendEnvelope = (envelope: ProtocolEnvelope): void => {
    const text = JSON.stringify(envelope);
    for (const client of clients) {
      if (client.readyState !== client.OPEN) {
        continue;
      }
      if (!shouldSendEnvelopeToSocket(envelope.type, authenticatedSockets.has(client))) {
        continue;
      }
      client.send(text);
    }
  };
  const broadcast = (envelope: ProtocolEnvelope): ApplyProtocolResult => {
    const applied = options.backend.applyProtocolEnvelope(envelope);
    if (!applied.ok) {
      return applied;
    }
    sendEnvelope(envelope);
    return applied;
  };
  return { broadcast, sendEnvelope };
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
