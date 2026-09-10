/**
 * OpenClaw Gateway raw WebSocket transport（协议版本 4，openclaw@2026.7.1-2）。
 *
 * 线协议要点：
 * - WS 打开后服务端先发事件 `connect.challenge { nonce }`；
 * - 客户端回 `req method="connect"`，params 含 min/maxProtocol、role=operator、
 *   scopes operator.read/write、client（id 白名单 gateway-client、mode backend）与 auth.token；
 * - 创建 run：`req method="agent"`，params { message, idempotencyKey, agentId?, sessionKey?, timeout? }；
 * - 读取：`req method="agent.wait" { runId, timeoutMs? }` 后结合 audit/task/history 探针；
 * - 取消：`req method="chat.abort" { sessionKey?, runId? }`。
 *
 * 不拥有：Lanxing job store、权限裁决、affair 生命周期、凭据明文。
 * 副作用：连接 Gateway WebSocket，发送 JSON RPC 帧。
 */

import WebSocket from "ws";
import type { OpenClawGatewayCapabilities } from "../../../evidence/openclaw-execution-evidence.js";
import type { OpenClawRunContext, OpenClawRunSnapshot } from "../../runtime-client.js";
import {
canonicalizeGatewaySessionKey,
DEFAULT_GATEWAY_AGENT_ID,
} from "../session-key.js";
import {
GatewayTransportError,
type GatewayCreateRunRequest,
type GatewayTransport,
} from "../transport.js";
import { collectSupplementalEvidence } from "./evidence/probes.js";
import { normalizeRunSnapshot } from "./evidence/snapshot.js";
import { readAbortProof, requireStoppedRun } from "./evidence/cancel-proof.js";
import { readString } from "./framing/readers.js";
import { readCapabilities } from "./session/capabilities.js";

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
  /** 仅自托管 Gateway owner 可显式开启；取消连接请求 admin 以停止旧连接持有的 run。 */
  allowAdminAbort?: boolean;
}

/** raw WS transport 运行时上下文。 */
interface RawWebSocketGatewayTransportRuntime {
  /** 创建 transport 时传入的选项。 */
  options: RawWebSocketGatewayTransportOptions;
  /** runId -> sessionKey 映射；用于后续 read/cancel 关联 history/task。 */
  runSessionKeys: Map<string, string>;
  /** RPC/连接超时毫秒。 */
  timeoutMs: number;
  /** agent.wait 单次等待毫秒。 */
  getRunTimeoutMs: number;
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
  const runtime: RawWebSocketGatewayTransportRuntime = {
    options,
    runSessionKeys: new Map<string, string>(),
    timeoutMs: options.timeoutMs ?? 10_000,
    getRunTimeoutMs: options.getRunTimeoutMs ?? DEFAULT_GET_RUN_TIMEOUT_MS,
  };
  return {
    createRun: (request) => createGatewayRun(runtime, request),
    getRun: (runId, context) => getGatewayRun(runtime, runId, context),
    cancelRun: (runId, context) => cancelGatewayRun(runtime, runId, context),
  };
}

async function createGatewayRun(
  runtime: RawWebSocketGatewayTransportRuntime,
  request: GatewayCreateRunRequest,
): Promise<OpenClawRunSnapshot> {
  const token = await requireToken(runtime.options);
  const connection = await openGatewayConnection(runtime.options, token, runtime.timeoutMs);
  const { ws } = connection;
  try {
    const sessionKey =
      canonicalizeGatewaySessionKey(
        request.sessionKey,
        request.agentId?.trim() || DEFAULT_GATEWAY_AGENT_ID,
        request.jobId,
      ) ?? request.sessionKey;
    const payload = await rpc(
      ws,
      "agent",
      createRunParams({ ...request, sessionKey }),
      runtime.timeoutMs,
    );
    const runId = readString(payload, ["runId", "id"]);
    if (!runId) {
      throw new GatewayTransportError("gateway_invalid_run", "agent 响应缺少 runId", false);
    }
    runtime.runSessionKeys.set(runId, sessionKey);
    return normalizeRunSnapshot(payload, "createRun", {
      context: { ...request, sessionKey },
      capabilities: connection.capabilities,
      sessionKey,
    });
  } finally {
    ws.close();
  }
}

async function getGatewayRun(
  runtime: RawWebSocketGatewayTransportRuntime,
  runId: string,
  context?: OpenClawRunContext,
): Promise<OpenClawRunSnapshot> {
  const token = await requireToken(runtime.options);
  const connection = await openGatewayConnection(runtime.options, token, runtime.timeoutMs);
  const { ws } = connection;
  try {
    const payload = await rpc(ws, "agent.wait", { runId, timeoutMs: runtime.getRunTimeoutMs }, runtime.timeoutMs);
    const sessionKey = canonicalizeGatewaySessionKey(
      context?.sessionKey ?? runtime.runSessionKeys.get(runId) ?? null,
      DEFAULT_GATEWAY_AGENT_ID,
      context?.jobId,
    );
    const probes = await collectSupplementalEvidence(
      ws,
      connection.capabilities,
      { ...context, sessionKey, runId, timeoutMs: runtime.timeoutMs },
      rpc,
    );
    return normalizeRunSnapshot(payload, "getRun", {
      ...(context ? { context } : {}),
      capabilities: connection.capabilities,
      sessionKey,
      probeEvidence: probes,
    });
  } finally {
    ws.close();
  }
}

async function cancelGatewayRun(
  runtime: RawWebSocketGatewayTransportRuntime,
  runId: string,
  context?: OpenClawRunContext,
): Promise<OpenClawRunSnapshot> {
  const token = await requireToken(runtime.options);
  const connection = await openGatewayConnection(runtime.options, token, runtime.timeoutMs,
    runtime.options.allowAdminAbort === true);
  const { ws } = connection;
  try {
    const sessionKey = canonicalizeGatewaySessionKey(
      context?.sessionKey ?? runtime.runSessionKeys.get(runId) ?? null,
      DEFAULT_GATEWAY_AGENT_ID,
      context?.jobId,
    );
    const ack = await rpc(ws, "chat.abort", { ...(sessionKey ? { sessionKey } : {}), runId }, runtime.timeoutMs);
    readAbortProof(ack, runId);
    // abort 响应只证明取消已受理；等待同一 run 的退出，不能提前提交父终态。
    return requireStoppedRun(await getGatewayRun(runtime, runId, context), runId);
  } finally {
    ws.close();
  }
}

function createRunParams(request: GatewayCreateRunRequest): Record<string, unknown> {
  const idempotencyKey = request.idempotencyKey?.trim() || `lanxing:${request.sessionKey}`;
  return {
    message: request.input,
    idempotencyKey,
    ...(request.agentId ? { agentId: request.agentId } : {}),
    ...(request.sessionKey ? { sessionKey: request.sessionKey } : {}),
    ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
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
  adminAbort = false,
): Promise<{ ws: WebSocket; capabilities: OpenClawGatewayCapabilities }> {
  if (adminAbort && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(options.gatewayUrl).hostname)) {
    throw new GatewayTransportError("gateway_admin_abort_requires_loopback", "自托管取消控制面必须使用 loopback Gateway", false);
  }
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
        scopes: [...GATEWAY_OPERATOR_CONNECT_SCOPES, ...(adminAbort ? ["operator.admin"] : [])],
        caps: ["tool-events"],
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
    return { ws, capabilities: readCapabilities(result) };
  } catch (err) {
    ws.close();
    throw err;
  }
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

import { parseFrame, rpc } from "./framing/rpc.js";

import { takeGatewayEvent, waitSocketOpen } from "./session/waiters.js";
