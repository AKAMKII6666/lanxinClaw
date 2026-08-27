/**
 * raw WebSocket Gateway transport 契约（协议版本 4）。
 *
 * 职责：验证 connect.challenge 握手、agent/agent.wait/chat.abort 方法、
 * 状态映射与错误 fail-closed。
 * 不拥有：真实 OpenClaw Gateway、Lanxing permission gate。
 * 副作用：监听本机随机 WebSocket 端口。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocketServer } from "ws";
import {
  createRawWebSocketGatewayTransport,
  GatewayTransportError,
} from "../../src/index.js";

describe("raw websocket gateway transport (protocol v4)", () => {
  it("握手 connect.challenge → connect，然后 agent / agent.wait / chat.abort", async () => {
    const frames: Array<Record<string, unknown>> = [];
    const server = await startProtocolV4Server((frame) => {
      frames.push(frame);
      if (frame.method === "connect") {
        return { type: "hello-ok", protocol: 4, server: { version: "2026.7.1-2", connId: "conn-1" } };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_001", status: "accepted", summary: "accepted by gateway" };
      }
      if (frame.method === "agent.wait") {
        return { runId: "gw_run_001", status: "completed", endedAt: new Date().toISOString() };
      }
      if (frame.method === "chat.abort") {
        return { ok: true };
      }
      throw new GatewayTransportError("gateway_test_unexpected", `unexpected method ${String(frame.method)}`, false);
    });
    try {
      const transport = createRawWebSocketGatewayTransport({
        gatewayUrl: server.url,
        authProvider: () => "token-test",
        timeoutMs: 1000,
        getRunTimeoutMs: 500,
      });
      const created = await transport.createRun({
        agentId: "main",
        idempotencyKey: "lanxing-job:job_001",
        input: "read only",
        sessionKey: "lanxing-job:job_001",
        workspaceHint: "F:/workspace/demo",
        scopes: ["workspace.read"],
        timeoutMs: null,
      });
      const read = await transport.getRun("gw_run_001");
      const canceled = await transport.cancelRun("gw_run_001");

      assert.equal(created.status, "accepted");
      assert.equal(created.runId, "gw_run_001");
      assert.equal(read.status, "completed");
      assert.equal(canceled.status, "cancelled");

      const connectFrame = frames.find((f) => f.method === "connect");
      assert.ok(connectFrame);
      const connectParams = connectFrame?.params as {
        minProtocol?: number;
        maxProtocol?: number;
        role?: string;
        scopes?: string[];
        client?: { id?: string; mode?: string };
        auth?: { token?: string };
      };
      assert.equal(connectParams.minProtocol, 4);
      assert.equal(connectParams.maxProtocol, 4);
      assert.equal(connectParams.role, "operator");
      assert.deepEqual(connectParams.scopes, ["operator.read", "operator.write"]);
      assert.equal(connectParams.client?.id, "gateway-client");
      assert.equal(connectParams.client?.mode, "backend");
      assert.equal(connectParams.auth?.token, "token-test");

      const agentFrame = frames.find((f) => f.method === "agent");
      const agentParams = agentFrame?.params as { message?: string; idempotencyKey?: string; sessionKey?: string };
      assert.equal(agentParams.message, "read only");
      assert.equal(agentParams.idempotencyKey, "lanxing-job:job_001");
      assert.equal(agentParams.sessionKey, "lanxing-job:job_001");

      const waitFrame = frames.find((f) => f.method === "agent.wait");
      const waitParams = waitFrame?.params as { runId?: string; timeoutMs?: number };
      assert.equal(waitParams.runId, "gw_run_001");

      const abortFrame = frames.find((f) => f.method === "chat.abort");
      const abortParams = abortFrame?.params as { runId?: string; sessionKey?: string };
      assert.equal(abortParams.runId, "gw_run_001");
      assert.equal(abortParams.sessionKey, "lanxing-job:job_001");
    } finally {
      await server.close();
    }
  });

  it("agent.wait 返回 timeout 视为仍在运行（running）", async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        return { type: "hello-ok", protocol: 4, server: { version: "x", connId: "c" } };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_wait", status: "accepted" };
      }
      if (frame.method === "agent.wait") {
        return { runId: "gw_run_wait", status: "timeout", timeoutPhase: "queue" };
      }
      throw new GatewayTransportError("gateway_test_unexpected", "unexpected", false);
    });
    try {
      const transport = createRawWebSocketGatewayTransport({
        gatewayUrl: server.url,
        authProvider: () => "t",
        timeoutMs: 1000,
        getRunTimeoutMs: 200,
      });
      const created = await transport.createRun({
        agentId: "main",
        idempotencyKey: "k",
        input: "x",
        sessionKey: "lanxing-job:k",
        workspaceHint: null,
        scopes: [],
        timeoutMs: null,
      });
      const read = await transport.getRun(created.runId);
      assert.equal(read.status, "running");
    } finally {
      await server.close();
    }
  });

  it("Gateway RPC 错误保留 code/retryable，不回退 fake", async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        return { type: "hello-ok", protocol: 4, server: { version: "x", connId: "c" } };
      }
      throw new GatewayTransportError("gateway_auth_failed", "scope missing", false);
    });
    try {
      const transport = createRawWebSocketGatewayTransport({
        gatewayUrl: server.url,
        authProvider: () => "token-test",
        timeoutMs: 1000,
      });
      await assert.rejects(
        () => transport.getRun("gw_run_denied"),
        (err) =>
          err instanceof GatewayTransportError &&
          err.code === "gateway_auth_failed" &&
          err.retryable === false,
      );
    } finally {
      await server.close();
    }
  });

  it("connect 响应非 hello-ok 拒绝", async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        throw new GatewayTransportError("gateway_scope_missing", "缺少 scope", false);
      }
      return {};
    });
    try {
      const transport = createRawWebSocketGatewayTransport({
        gatewayUrl: server.url,
        authProvider: () => "token-test",
        timeoutMs: 1000,
      });
      await assert.rejects(
        () => transport.createRun({
          agentId: "main",
          input: "x",
          sessionKey: "lanxing-job:k",
          workspaceHint: null,
          scopes: [],
          timeoutMs: null,
        }),
        (err) => err instanceof GatewayTransportError && err.code === "gateway_scope_missing",
      );
    } finally {
      await server.close();
    }
  });
});

/**
 * 启动模拟协议 v4 的 Gateway server。
 */
async function startProtocolV4Server(
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
