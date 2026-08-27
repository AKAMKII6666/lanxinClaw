/**
 * HTTP 路由：健康检查、控制面板 UI 契约、事件日志、可选 POST 入站。
 *
 * 职责：暴露 mock companion 的 HTTP 面；不执行电脑副作用。
 * 不拥有：WebSocket 升级、真实诊断探针、凭据明文。
 * 副作用：读写 HTTP 请求响应；POST /protocol/message 会更新 store。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { MockCompanionConfig } from "../config.js";
import {
  buildErrorBody,
  peekSourceDeviceId,
  routeInboundMessage,
} from "./message-router.js";
import type { EmitEnvelope } from "../pairing/handle-pairing.js";
import type { MemoryStore } from "../store/memory-store.js";
import {
  buildControlPanelSnapshot,
  buildDiagnosticReport,
  buildPermissionQueue,
} from "../ui/build-ui-views.js";
import { applyMockPermissionDecision } from "../jobs/handle-mock-permission.js";

/**
 * 读取请求 body 文本。
 *
 * @param req 入站请求
 * @returns body 字符串
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/**
 * 写入 JSON 响应。
 *
 * @param res 响应
 * @param status HTTP 状态
 * @param body 可序列化对象
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  store: MemoryStore,
  config: MockCompanionConfig,
  emit: EmitEnvelope,
  url: URL,
) => Promise<void> | void;

/**
 * GET 路由表。
 */
const GET_ROUTES: Record<string, RouteHandler> = {
  "/health": (_req, res, _store, config) => {
    sendJson(res, 200, {
      ok: true,
      service: "mock-companion",
      version: config.companionVersion,
      desktopDeviceId: config.desktopDeviceId,
      jobScenario: config.jobScenario,
    });
  },
  "/ui/snapshot": (_req, res, store, config) => {
    sendJson(res, 200, buildControlPanelSnapshot(store, config));
  },
  "/ui/permission-queue": (_req, res, store) => {
    sendJson(res, 200, buildPermissionQueue(store));
  },
  "/ui/diagnostic-report": (_req, res, store, config) => {
    sendJson(res, 200, buildDiagnosticReport(store, config));
  },
  "/events": (_req, res, store, _config, _emit, url) => {
    const since = url.searchParams.get("since");
    const events =
      since === null || since === ""
        ? store.events
        : store.events.filter((item) => item.sentAt >= since);
    sendJson(res, 200, { count: events.length, events });
  },
  "/": (_req, res) => {
    sendJson(res, 200, {
      service: "@lanxin-claw/mock-companion",
      endpoints: [
        "GET /health",
        "GET /ui/snapshot",
        "GET /ui/permission-queue",
        "GET /ui/diagnostic-report",
        "GET /events",
        "POST /protocol/message",
        "POST /ui/permission-decide",
        "WS /ws",
      ],
    });
  },
};

/**
 * 处理 POST /protocol/message。
 *
 * @param req 请求
 * @param res 响应
 * @param store store
 * @param config 配置
 * @param emit 出站
 */
async function handleProtocolPost(
  req: IncomingMessage,
  res: ServerResponse,
  store: MemoryStore,
  config: MockCompanionConfig,
  emit: EmitEnvelope,
): Promise<void> {
  const text = await readBody(req);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    sendJson(res, 400, {
      ok: false,
      error: { code: "invalid_json", message: "body 不是合法 JSON", retryable: false },
    });
    return;
  }
  const result = routeInboundMessage(store, config, raw, emit);
  if (!result.ok) {
    sendJson(res, 400, buildErrorBody(config, peekSourceDeviceId(raw), result.error, undefined));
    return;
  }
  sendJson(res, 202, { ok: true });
}

/**
 * 处理 POST /ui/permission-decide（模拟桌面 permission.decide）。
 *
 * @param req 请求
 * @param res 响应
 * @param store store
 * @param config 配置
 * @param emit 出站
 */
async function handlePermissionDecidePost(
  req: IncomingMessage,
  res: ServerResponse,
  store: MemoryStore,
  config: MockCompanionConfig,
  emit: EmitEnvelope,
): Promise<void> {
  const text = await readBody(req);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    sendJson(res, 400, {
      ok: false,
      error: { code: "invalid_json", message: "body 不是合法 JSON", retryable: false },
    });
    return;
  }
  const body = raw as { permissionRequestId?: string; decision?: string };
  if (!body.permissionRequestId || !body.decision) {
    sendJson(res, 400, {
      ok: false,
      error: {
        code: "invalid_payload",
        message: "须含 permissionRequestId 与 decision",
        retryable: false,
      },
    });
    return;
  }
  const result = applyMockPermissionDecision(store, config, {
    permissionRequestId: body.permissionRequestId,
    decision: body.decision,
  }, emit);
  if (!result.ok) {
    sendJson(res, 400, { ok: false, error: result.error });
    return;
  }
  sendJson(res, 200, { ok: true });
}

/**
 * 处理单条 HTTP 请求。
 *
 * @param req 请求
 * @param res 响应
 * @param store 内存 store
 * @param config 配置
 * @param emit 出站（HTTP POST 时同步记入 events）
 * @returns 是否已处理（false 表示交给其它层）
 */
export async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: MemoryStore,
  config: MockCompanionConfig,
  emit: EmitEnvelope,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${config.port}`);
  const path = url.pathname;

  if (req.method === "GET") {
    const handler = GET_ROUTES[path];
    if (handler) {
      await handler(req, res, store, config, emit, url);
      return true;
    }
  }

  if (req.method === "POST" && path === "/protocol/message") {
    await handleProtocolPost(req, res, store, config, emit);
    return true;
  }

  if (req.method === "POST" && path === "/ui/permission-decide") {
    await handlePermissionDecidePost(req, res, store, config, emit);
    return true;
  }

  sendJson(res, 404, { ok: false, error: { code: "not_found", message: path, retryable: false } });
  return true;
}
