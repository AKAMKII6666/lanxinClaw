/**
 * 桌面 companion 电话协议服务。
 *
 * 职责：监听本机 HTTP/WS 端口，并把 phone envelope 交给 backend router。
 * 不拥有：renderer、OpenClaw core、phone 主仓。
 * 副作用：监听 TCP 端口；广播协议消息。
 */

import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { Logger } from "pino";
import { createEnvelope, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { PairingLifecycleDeps } from "../pairing/lifecycle.js";
import type { PairingSession } from "../pairing/session.js";
import type { DeviceIdentityStore } from "../credentials/identity-store.js";
import type { CompanionBackendRuntime } from "../backend/runtime.js";
import type { ApplyProtocolResult } from "../state/types.js";
import { approvePendingPairing, handleProtocolSocketMessage } from "./router.js";
import { isLoopbackAddress } from "./guards/http/http-guard.js";
import { shouldSendEnvelopeToSocket } from "./guards/ws/ws-audience.js";
import { createProtocolLogDto } from "./protocol-log-dto.js";

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
  /** 协议落盘日志；只记录 redacted DTO 与状态证据 */
  logger?: Logger;
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

interface PendingPairingRef { current: PairingSession | null; }

interface ProtocolSocketRuntime {
  options: CompanionProtocolServerOptions;
  clients: Set<WebSocket>;
  authenticatedSockets: Set<WebSocket>;
  pendingPairing: PendingPairingRef;
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult;
  sendEnvelope: (envelope: ProtocolEnvelope) => void;
  replaceAuthenticatedSocket: (socket: WebSocket) => void;
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
  const pendingPairing: PendingPairingRef = { current: null };
  const httpServer = createProtocolHttpServer(options);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const { broadcast, sendEnvelope } = createProtocolBroadcaster(options, clients, authenticatedSockets);
  let closed = false;
  const heartbeatTimer = startHeartbeatMonitor(options, broadcast, authenticatedSockets);
  const replaceAuthenticatedSocket = createAuthenticatedSocketReplacer(options, authenticatedSockets);
  bindProtocolWebSocketServer(wss, {
    options,
    clients,
    authenticatedSockets,
    pendingPairing,
    broadcast,
    sendEnvelope,
    replaceAuthenticatedSocket,
  });

  await listen(httpServer, options.port ?? 0, host);
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("companion_protocol_bind_failed");
  }
  options.logger?.info(
    { event: "protocol.server.listening", host, port: address.port },
    "协议服务器已监听",
  );
  return {
    baseUrl: `http://${host}:${address.port}`,
    wsUrl: `ws://${host}:${address.port}/ws`,
    port: address.port,
    broadcast,
    sendEnvelope,
    replaceAuthenticatedSocket,
    clearAuthenticatedSockets: () => clearAuthenticatedSockets(options, authenticatedSockets),
    approvePairing: (pairingId) =>
      approvePendingPairing(options, pendingPairing.current, pairingId, broadcast),
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeatTimer);
      await closeServer(httpServer, wss, clients);
      options.logger?.info({ event: "protocol.server.closed" }, "协议服务器已关闭");
    },
  };
}

function createAuthenticatedSocketReplacer(
  options: CompanionProtocolServerOptions,
  authenticatedSockets: Set<WebSocket>,
): (socket: WebSocket) => void {
  return (socket) => {
    const previousAuthenticatedCount = authenticatedSockets.size;
    for (const old of authenticatedSockets) {
      if (old !== socket && old.readyState === old.OPEN) {
        old.terminate();
      }
    }
    authenticatedSockets.clear();
    authenticatedSockets.add(socket);
    options.logger?.info(
      { event: "protocol.session.socket_replaced", previousAuthenticatedCount },
      "协议 session socket 已替换",
    );
  };
}

function clearAuthenticatedSockets(
  options: CompanionProtocolServerOptions,
  authenticatedSockets: Set<WebSocket>,
): void {
  const clearedCount = authenticatedSockets.size;
  authenticatedSockets.clear();
  options.logger?.info(
    { event: "protocol.session.sockets_cleared", clearedCount },
    "协议 authenticated sockets 已清理",
  );
}

function bindProtocolWebSocketServer(
  wss: WebSocketServer,
  runtime: ProtocolSocketRuntime,
): void {
  wss.on("connection", (socket, req) => {
    handleProtocolSocketConnection(runtime, socket, req);
  });
}

function handleProtocolSocketConnection(
  runtime: ProtocolSocketRuntime,
  socket: WebSocket,
  req: IncomingMessage,
): void {
  runtime.clients.add(socket);
  runtime.options.logger?.info(
    {
      event: "protocol.ws.connected",
      remoteAddress: req.socket.remoteAddress,
      remotePort: req.socket.remotePort,
      clientCount: runtime.clients.size,
    },
    "协议 WS 已连接",
  );
  socket.on("message", (data) => {
    handleProtocolSocketData(runtime, socket, data.toString());
  });
  socket.on("close", (code, reason) => {
    handleProtocolSocketClose(runtime, socket, code, reason.toString());
  });
}

function handleProtocolSocketData(
  runtime: ProtocolSocketRuntime,
  socket: WebSocket,
  text: string,
): void {
  runtime.options.logger?.info(
    { event: "protocol.inbound.dto", dto: createProtocolLogDto(text) },
    "协议入站 DTO",
  );
  void handleProtocolSocketMessage({
    options: runtime.options,
    text,
    broadcast: runtime.broadcast,
    sendEnvelope: runtime.sendEnvelope,
    socket,
    getPending: () => runtime.pendingPairing.current,
    setPending: (session) => {
      runtime.pendingPairing.current = session;
    },
    markSocketAuthenticated: runtime.replaceAuthenticatedSocket,
    isSocketAuthenticated: () => runtime.authenticatedSockets.has(socket),
  }).catch((error: unknown) => {
    runtime.options.logger?.error(
      {
        event: "protocol.inbound.handle_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      "协议入站处理异常",
    );
  });
}

function handleProtocolSocketClose(
  runtime: ProtocolSocketRuntime,
  socket: WebSocket,
  code: number,
  reason: string,
): void {
  runtime.clients.delete(socket);
  const wasAuthenticated = runtime.authenticatedSockets.delete(socket);
  if (
    wasAuthenticated &&
    runtime.authenticatedSockets.size === 0 &&
    runtime.options.backend.getState().connection.sessionAuthenticated
  ) {
    runtime.options.backend.markConnectionLost();
  }
  runtime.options.logger?.info(
    {
      event: "protocol.ws.closed",
      code,
      reason,
      clientCount: runtime.clients.size,
      authenticatedSocketCount: runtime.authenticatedSockets.size,
      wasAuthenticated,
    },
    "协议 WS 已关闭",
  );
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
    options.logger?.warn(
      {
        event: "protocol.session.heartbeat_timeout",
        phoneDeviceId: connection.phoneDeviceId,
        sessionId: connection.sessionId,
        lastSeenAt: connection.lastSeenAt,
        thresholdMs,
      },
      "协议 session 心跳超时",
    );
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
    let sentCount = 0;
    let skippedCount = 0;
    for (const client of clients) {
      if (client.readyState !== client.OPEN) {
        skippedCount += 1;
        continue;
      }
      if (!shouldSendEnvelopeToSocket(envelope.type, authenticatedSockets.has(client))) {
        skippedCount += 1;
        continue;
      }
      client.send(text);
      sentCount += 1;
    }
    options.logger?.info(
      {
        event: "protocol.outbound.dto",
        dto: createProtocolLogDto(envelope),
        sentCount,
        skippedCount,
      },
      "协议出站 DTO",
    );
  };
  const broadcast = (envelope: ProtocolEnvelope): ApplyProtocolResult => {
    const applied = options.backend.applyProtocolEnvelope(envelope);
    if (!applied.ok) {
      options.logger?.warn(
        { event: "protocol.broadcast.apply_failed", dto: createProtocolLogDto(envelope), applied },
        "协议广播 apply 失败",
      );
      return applied;
    }
    options.logger?.info(
      { event: "protocol.broadcast.applied", dto: createProtocolLogDto(envelope) },
      "协议广播已写入状态",
    );
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
