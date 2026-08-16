/**
 * OpenClaw Gateway raw WebSocket transport。
 *
 * 职责：实现 Gateway 文档的 connect/req/res 线协议，并规范化 run 快照。
 * 不拥有：Lanxing job store、权限裁决、官方 SDK 封装。
 * 副作用：连接 Gateway WebSocket，发送 JSON RPC 帧。
 */

import WebSocket from "ws";
import type { OpenClawRunSnapshot } from "../../runtime-client.js";
import type { OpenClawRunStatus } from "../../../status/openclaw-run-status.js";
import {
  GatewayTransportError,
  type GatewayCreateRunRequest,
  type GatewayTransport,
} from "../transport.js";

/**
 * Raw WS transport 选项。
 */
export interface RawWebSocketGatewayTransportOptions {
  /** Gateway WebSocket URL */
  gatewayUrl: string;
  /** 读取 Gateway token；不得写日志 */
  authProvider: () => Promise<string | null> | string | null;
  /** client 名称；用于 connect 元数据 */
  clientName?: string;
  /** client 版本；用于 connect 元数据 */
  clientVersion?: string;
  /** RPC 超时 */
  timeoutMs?: number;
  /** 可覆盖方法名，便于跟随 Gateway 协议演进 */
  methods?: Partial<RawGatewayMethodNames>;
}

/**
 * Gateway RPC 方法名。
 */
export interface RawGatewayMethodNames {
  /** 创建 run/session */
  createRun: string;
  /** 读取 run 状态 */
  getRun: string;
  /** 取消 run/session */
  cancelRun: string;
}

const DEFAULT_METHODS: RawGatewayMethodNames = {
  createRun: "runs.create",
  getRun: "runs.get",
  cancelRun: "runs.cancel",
};

const STATUS_ALIASES: Record<string, OpenClawRunStatus> = {
  accepted: "accepted",
  agent_event: "accepted",
  running: "running",
  approval_required: "waiting_approval",
  "approval.request": "waiting_approval",
  waiting_approval: "waiting_approval",
  blocked: "blocked",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  aborted: "cancelled",
  abort: "cancelled",
  timed_out: "timed_out",
};

/**
 * 创建 raw WS Gateway transport。
 *
 * @param options 选项
 * @returns transport
 */
export function createRawWebSocketGatewayTransport(
  options: RawWebSocketGatewayTransportOptions,
): GatewayTransport {
  const methods = { ...DEFAULT_METHODS, ...options.methods };
  return {
    async createRun(request) {
      const payload = await callGateway(options, methods.createRun, {
        agentId: request.agentId,
        input: request.input,
        sessionKey: request.sessionKey,
        workspaceHint: request.workspaceHint,
        scopes: [...request.scopes],
        timeoutMs: request.timeoutMs,
      });
      return normalizeRunSnapshot(payload, "createRun");
    },
    async getRun(runId) {
      const payload = await callGateway(options, methods.getRun, { runId });
      return normalizeRunSnapshot(payload, "getRun");
    },
    async cancelRun(runId) {
      const payload = await callGateway(options, methods.cancelRun, { runId });
      return normalizeRunSnapshot(payload, "cancelRun");
    },
  };
}

/**
 * 调用 Gateway RPC。
 */
async function callGateway(
  options: RawWebSocketGatewayTransportOptions,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const token = await options.authProvider();
  if (!token?.trim()) {
    throw new GatewayTransportError("gateway_auth_missing", "Gateway token 缺失", false);
  }
  const ws = await openGatewaySocket(options.gatewayUrl, token, options);
  try {
    return await sendRequest(ws, method, params, options.timeoutMs ?? 10_000);
  } finally {
    ws.close();
  }
}

/**
 * 建立 Gateway WS，并发送 connect 帧。
 */
async function openGatewaySocket(
  gatewayUrl: string,
  token: string,
  options: RawWebSocketGatewayTransportOptions,
): Promise<WebSocket> {
  const ws = new WebSocket(gatewayUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new GatewayTransportError("gateway_connect_timeout", "Gateway 连接超时", true));
    }, options.timeoutMs ?? 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new GatewayTransportError("gateway_connect_failed", err.message, true));
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });
  ws.send(JSON.stringify({
    type: "connect",
    token,
    client: {
      name: options.clientName ?? "lanxin-claw",
      version: options.clientVersion ?? "0.1.0",
    },
  }));
  return ws;
}

/**
 * 发送 req 并等待 res。
 */
async function sendRequest(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const id = `gw_req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new GatewayTransportError("gateway_timeout", `Gateway RPC 超时: ${method}`, true));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onMessage = (data: WebSocket.RawData) => {
      const frame = parseGatewayFrame(data);
      if (!isResponseFor(frame, id)) {
        return;
      }
      cleanup();
      if (frame.ok) {
        resolve(frame.payload ?? frame.result ?? null);
        return;
      }
      reject(errorFromFrame(frame));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new GatewayTransportError("gateway_socket_error", err.message, true));
    };
    const onClose = () => {
      cleanup();
      reject(new GatewayTransportError("gateway_socket_closed", "Gateway 连接提前关闭", true));
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

/**
 * 解析 Gateway frame。
 */
function parseGatewayFrame(data: WebSocket.RawData): Record<string, unknown> {
  try {
    const value = JSON.parse(data.toString()) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * 判断是否目标响应帧。
 */
function isResponseFor(frame: Record<string, unknown>, id: string): frame is Record<string, unknown> & { ok?: boolean } {
  return frame.type === "res" && frame.id === id;
}

/**
 * 从响应帧生成错误。
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
 */
function normalizeRunSnapshot(value: unknown, operation: string): OpenClawRunSnapshot {
  if (!value || typeof value !== "object") {
    throw new GatewayTransportError("gateway_invalid_run", `${operation} 返回值不是 run 对象`, false);
  }
  const raw = value as Record<string, unknown>;
  const runId = readString(raw, ["runId", "id"]);
  const status = normalizeStatus(readString(raw, ["status", "state"]));
  if (!runId || !status) {
    throw new GatewayTransportError("gateway_invalid_run", `${operation} 返回值缺少 runId/status`, false);
  }
  return {
    runId,
    status,
    ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}),
    ...(typeof raw.blockedReason === "string" ? { blockedReason: raw.blockedReason } : {}),
    ...(typeof raw.resumeCondition === "string" ? { resumeCondition: raw.resumeCondition } : {}),
  };
}

/**
 * 读取字符串字段。
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
 */
function normalizeStatus(value: string | null): OpenClawRunStatus | null {
  if (!value) {
    return null;
  }
  return STATUS_ALIASES[value.toLowerCase()] ?? null;
}
