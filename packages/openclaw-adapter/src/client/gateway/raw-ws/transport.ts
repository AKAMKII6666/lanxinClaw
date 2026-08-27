/**
 * OpenClaw Gateway raw WebSocket transport（协议版本 4，openclaw@2026.7.1-2）。
 *
 * 线协议要点：
 * - WS 打开后服务端先发事件 `connect.challenge { nonce }`；
 * - 客户端回 `req method="connect"`，params 含 min/maxProtocol、role=operator、
 *   scopes operator.read/write、client（id 白名单 gateway-client、mode backend）与 auth.token；
 * - 创建 run：`req method="agent"`，params { message, idempotencyKey, agentId?, sessionKey?, timeout? }；
 * - 读取：`req method="agent.wait" { runId, timeoutMs? }`（只返回终态；timeout 表示仍在跑）；
 * - 取消：`req method="chat.abort" { sessionKey?, runId? }`。
 *
 * 不拥有：Lanxing job store、权限裁决、affair 生命周期、凭据明文。
 * 副作用：连接 Gateway WebSocket，发送 JSON RPC 帧。
 */

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { OpenClawRunSnapshot } from "../../runtime-client.js";
import type { OpenClawRunStatus } from "../../../status/openclaw-run-status.js";
import {
  GatewayTransportError,
  type GatewayCreateRunRequest,
  type GatewayTransport,
} from "../transport.js";

/** Gateway 协议版本 */
const PROTOCOL_VERSION = 4;
/** 客户端 id 白名单（自定义 id 会被 1008 拒绝） */
const GATEWAY_CLIENT_ID = "gateway-client";
/** 客户端 mode 白名单 */
const GATEWAY_CLIENT_MODE = "backend";
/**
 * 自托管 companion 作为 Gateway operator 声明的控制面 scope。
 * 与澜星 permission id（如 workspace.read）不是同一套；缺 operator.write 时
 * `agent` RPC 会被 Gateway 以 INVALID_REQUEST: missing scope: operator.write 拒绝。
 */
const GATEWAY_OPERATOR_CONNECT_SCOPES = ["operator.read", "operator.write"] as const;
/** agent.wait 单次等待毫秒（默认） */
const DEFAULT_GET_RUN_TIMEOUT_MS = 3_000;

/** 状态别名 → 规范化状态；agent.wait 的 timeout 视为仍在运行 */
const STATUS_ALIASES: Record<string, OpenClawRunStatus> = {
  accepted: "accepted",
  queued: "accepted",
  running: "running",
  approval_required: "waiting_approval",
  "approval.request": "waiting_approval",
  waiting_approval: "waiting_approval",
  blocked: "blocked",
  completed: "completed",
  failed: "failed",
  error: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
  aborted: "cancelled",
  abort: "cancelled",
  timed_out: "timed_out",
  timeout: "running",
};

/** raw WS transport 选项 */
export interface RawWebSocketGatewayTransportOptions {
  /** Gateway WebSocket URL */
  gatewayUrl: string;
  /** 读取 Gateway token；不得写日志 */
  authProvider: () => Promise<string | null> | string | null;
  /** client 展示名；connect 元数据 */
  clientName?: string;
  /** client 版本；connect 元数据 */
  clientVersion?: string;
  /** RPC/连接超时毫秒；默认 10000 */
  timeoutMs?: number;
  /** agent.wait 单次等待毫秒；默认 3000 */
  getRunTimeoutMs?: number;
}

/**
 * 创建 raw WS Gateway transport。
 *
 * @param options 选项
 * @returns transport
 */
export function createRawWebSocketGatewayTransport(
  options: RawWebSocketGatewayTransportOptions,
): GatewayTransport {
  const runSessionKeys = new Map<string, string>();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const getRunTimeoutMs = options.getRunTimeoutMs ?? DEFAULT_GET_RUN_TIMEOUT_MS;

  return {
    async createRun(request) {
      const token = await requireToken(options);
      const ws = await openGatewayConnection(options, token, timeoutMs);
      try {
        const idempotencyKey = request.idempotencyKey?.trim() || `lanxing:${request.sessionKey}`;
        const payload = await rpc(
          ws,
          "agent",
          {
            message: request.input,
            idempotencyKey,
            ...(request.agentId ? { agentId: request.agentId } : {}),
            ...(request.sessionKey ? { sessionKey: request.sessionKey } : {}),
            ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
          },
          timeoutMs,
        );
        const runId = readString(payload, ["runId", "id"]);
        if (!runId) {
          throw new GatewayTransportError("gateway_invalid_run", "agent 响应缺少 runId", false);
        }
        runSessionKeys.set(runId, request.sessionKey);
        return normalizeRunSnapshot(payload, "createRun");
      } finally {
        ws.close();
      }
    },

    async getRun(runId) {
      const token = await requireToken(options);
      const ws = await openGatewayConnection(options, token, timeoutMs);
      try {
        const payload = await rpc(ws, "agent.wait", { runId, timeoutMs: getRunTimeoutMs }, timeoutMs);
        return normalizeRunSnapshot(payload, "getRun");
      } finally {
        ws.close();
      }
    },

    async cancelRun(runId) {
      const token = await requireToken(options);
      const ws = await openGatewayConnection(options, token, timeoutMs);
      try {
        const sessionKey = runSessionKeys.get(runId);
        await rpc(
          ws,
          "chat.abort",
          {
            ...(sessionKey ? { sessionKey } : {}),
            runId,
          },
          timeoutMs,
        );
        return { runId, status: "cancelled", summary: "cancelled_by_adapter" };
      } finally {
        ws.close();
      }
    },
  };
}

/**
 * 读取 token；缺失 fail-closed。
 *
 * @param options 选项
 * @returns token
 */
async function requireToken(
  options: RawWebSocketGatewayTransportOptions,
): Promise<string> {
  const token = await options.authProvider();
  if (!token?.trim()) {
    throw new GatewayTransportError("gateway_auth_missing", "Gateway token 缺失", false);
  }
  return token.trim();
}

/**
 * 建立 Gateway WS 连接并完成 connect 握手。
 *
 * @param options 选项
 * @param token 鉴权 token
 * @param timeoutMs 超时
 * @returns 已握手的 socket
 */
async function openGatewayConnection(
  options: RawWebSocketGatewayTransportOptions,
  token: string,
  timeoutMs: number,
): Promise<WebSocket> {
  const ws = new WebSocket(options.gatewayUrl);
  // 常驻消息队列：ws 在 open 事件前到达的消息没有监听者会丢失，
  // 因此先挂队列收集，open 后再按需取用。
  const frameQueue: Array<Record<string, unknown>> = [];
  ws.on("message", (data) => {
    frameQueue.push(parseFrame(data));
  });
  await waitSocketOpen(ws, timeoutMs);
  try {
    await takeGatewayEvent(
      ws,
      frameQueue,
      (frame) => frame.type === "event" && frame.event === "connect.challenge",
      timeoutMs,
      "connect.challenge",
    );
    const result = await rpc(
      ws,
      "connect",
      {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        role: "operator",
        scopes: [...GATEWAY_OPERATOR_CONNECT_SCOPES],
        client: {
          id: GATEWAY_CLIENT_ID,
          displayName: options.clientName ?? "Lanxing Claw",
          version: options.clientVersion ?? "0.1.0",
          platform: process.platform,
          mode: GATEWAY_CLIENT_MODE,
        },
        auth: { token },
      },
      timeoutMs,
    );
    if (!isHelloOk(result)) {
      throw new GatewayTransportError(
        "gateway_connect_rejected",
        "Gateway connect 握手被拒绝",
        false,
      );
    }
    return ws;
  } catch (err) {
    ws.close();
    throw err;
  }
}

/**
 * 等待 socket open。
 *
 * @param ws socket
 * @param timeoutMs 超时
 * @returns 完成
 */
function waitSocketOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
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
function takeGatewayEvent(
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

/**
 * 发送 req 并等待 res。
 *
 * @param ws socket
 * @param method 方法名
 * @param params 参数
 * @param timeoutMs 超时
 * @returns 响应 payload
 */
async function rpc(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const id = `gw_${randomUUID()}`;
  ws.send(JSON.stringify({ type: "req", id, method, params }));
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
  });
}

/**
 * 解析 Gateway 帧。
 *
 * @param data 原始数据
 * @returns 帧
 */
function parseFrame(data: WebSocket.RawData): Record<string, unknown> {
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

/**
 * 规范化 Gateway run 快照。
 *
 * @param value 原始载荷
 * @param operation 操作名（错误信息用）
 * @returns 快照
 */
function normalizeRunSnapshot(value: unknown, operation: string): OpenClawRunSnapshot {
  if (!value || typeof value !== "object") {
    throw new GatewayTransportError("gateway_invalid_run", `${operation} 返回值不是 run 对象`, false);
  }
  const raw = value as Record<string, unknown>;
  const runId = readString(raw, ["runId", "id"]);
  const status = normalizeStatus(readString(raw, ["status", "state"]));
  const rawError = raw.error;
  if (!runId) {
    throw new GatewayTransportError("gateway_invalid_run", `${operation} 返回值缺少 runId`, false);
  }
  if (!status) {
    if (rawError && typeof rawError === "object") {
      const message = readString(rawError as Record<string, unknown>, ["message"]);
      return { runId, status: "failed", summary: message ?? "run_failed" };
    }
    throw new GatewayTransportError("gateway_invalid_run", `${operation} 返回值缺少 status`, false);
  }
  const snapshot: OpenClawRunSnapshot = { runId, status };
  const summary = readString(raw, ["summary", "progressSummary"]);
  if (summary) {
    snapshot.summary = summary;
  }
  if (rawError && typeof rawError === "object") {
    const error = rawError as Record<string, unknown>;
    const message = readString(error, ["message"]);
    if (message) {
      snapshot.summary = message;
      snapshot.blockedReason = snapshot.blockedReason ?? message;
    }
    if (status === "accepted" || status === "running") {
      snapshot.status = "failed";
    }
  }
  return snapshot;
}

/**
 * 读取字符串字段。
 *
 * @param raw 对象
 * @param keys 候选键
 * @returns 值或 null
 */
function readString(raw: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (typeof raw[key] === "string" && raw[key].trim()) {
      return raw[key] as string;
    }
  }
  return null;
}

/**
 * 归一 Gateway 状态。
 *
 * @param value 原始状态
 * @returns 规范化状态或 null
 */
function normalizeStatus(value: string | null): OpenClawRunStatus | null {
  if (!value) {
    return null;
  }
  return STATUS_ALIASES[value.toLowerCase()] ?? null;
}

/**
 * 判断 connect 响应是否为 hello-ok。
 *
 * @param payload 响应载荷
 * @returns 是否成功
 */
function isHelloOk(payload: Record<string, unknown>): boolean {
  const type = readString(payload, ["type"]);
  if (type === "hello-ok") {
    return true;
  }
  return Boolean(readString(payload, ["connId"]) || readString(payload, ["server"]));
}
