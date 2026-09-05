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
        caps?: string[];
        client?: { id?: string; mode?: string };
        auth?: { token?: string };
      };
      assert.equal(connectParams.minProtocol, 4);
      assert.equal(connectParams.maxProtocol, 4);
      assert.equal(connectParams.role, "operator");
      assert.deepEqual(connectParams.scopes, ["operator.read", "operator.write"]);
      assert.deepEqual(connectParams.caps, ["tool-events"]);
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
      assert.equal(read.evidence?.wait?.status, "timeout");
      assert.equal(read.evidence?.wait?.timeoutPhase, "queue");
      assert.equal(read.evidence?.probeResults?.some((probe) => probe.ok === false), true);
    } finally {
      await server.close();
    }
  });

  it("agent 返回 in_flight 视为已接受而非非法 run", async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        return { type: "hello-ok", protocol: 4, server: { version: "x", connId: "c" } };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_in_flight", status: "in_flight", summary: "already running" };
      }
      throw new GatewayTransportError("gateway_test_unexpected", "unexpected", false);
    });
    try {
      const transport = createRawWebSocketGatewayTransport({
        gatewayUrl: server.url,
        authProvider: () => "t",
        timeoutMs: 1000,
      });
      const created = await transport.createRun({
        agentId: "main",
        idempotencyKey: "k-in-flight",
        input: "x",
        sessionKey: "lanxing-job:k-in-flight",
        workspaceHint: null,
        scopes: ["workspace.read"],
        timeoutMs: null,
      });
      assert.equal(created.status, "accepted");
      assert.equal(created.evidence?.wait?.status, "in_flight");
      assert.deepEqual(created.evidence?.sourceStatuses, ["in_flight", "accepted"]);
    } finally {
      await server.close();
    }
  });

  it("agent.wait 返回 timeout 且有 endedAt 时保留终态超时证据", async () => {
    const endedAt = "2026-07-22T00:00:00.000Z";
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        return { type: "hello-ok", protocol: 4, server: { version: "x", connId: "c" } };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_terminal_timeout", status: "accepted" };
      }
      if (frame.method === "agent.wait") {
        return { runId: "gw_run_terminal_timeout", status: "timeout", endedAt };
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
        idempotencyKey: "k-terminal-timeout",
        input: "x",
        sessionKey: "lanxing-job:k-terminal-timeout",
        workspaceHint: null,
        scopes: [],
        timeoutMs: null,
      });
      const read = await transport.getRun(created.runId);
      assert.equal(read.status, "timed_out");
      assert.equal(read.evidence?.wait?.timeoutPhase, "terminal");
      assert.equal(read.evidence?.lifecycle?.terminalPhase, "timeout");
      assert.deepEqual(read.evidence?.sourceStatuses, ["timeout", "timed_out"]);
    } finally {
      await server.close();
    }
  });

  it("agent.wait 响应体内 toolFindings 进入证据", async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        return { type: "hello-ok", protocol: 4, features: { methods: [], events: [] }, server: { connId: "c" } };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_inline_tools", status: "accepted" };
      }
      if (frame.method === "agent.wait") {
        return {
          runId: "gw_run_inline_tools",
          status: "ok",
          endedAt: "2026-07-22T00:00:00.000Z",
          toolFindings: [
            {
              toolName: "browser.open",
              status: "failed",
              errorCode: "policy_blocked",
              summary: "Browser launch blocked by policy",
            },
          ],
        };
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
        idempotencyKey: "k-inline-tools",
        input: "open news",
        sessionKey: "lanxing-job:job_inline_tools",
        workspaceHint: null,
        scopes: ["desktop.control"],
        timeoutMs: null,
      });
      const read = await transport.getRun(created.runId);
      assert.equal(read.evidence?.toolFindings[0]?.status, "blocked");
      assert.equal(read.evidence?.toolFindings[0]?.toolName, "browser.open");
    } finally {
      await server.close();
    }
  });

  it("agent.wait ok 保留 history 负向最终回复证据", async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        return {
          type: "hello-ok",
          protocol: 4,
          features: { methods: ["chat.history"], events: [] },
          server: { version: "x", connId: "c" },
        };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_history", status: "accepted" };
      }
      if (frame.method === "agent.wait") {
        return {
          runId: "gw_run_history",
          status: "ok",
          endedAt: "2026-07-22T00:00:00.000Z",
        };
      }
      if (frame.method === "chat.history") {
        return {
          messages: [
            {
              role: "assistant",
              text: "浏览器受策略限制，无法打开新闻页。",
            },
          ],
        };
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
        idempotencyKey: "k-history",
        input: "open news",
        sessionKey: "lanxing-job:job_history",
        workspaceHint: null,
        scopes: ["desktop.control"],
        timeoutMs: null,
      });
      const read = await transport.getRun(created.runId, {
        jobId: "job_history",
        affairId: "affair_history",
        sessionKey: "lanxing-job:job_history",
      });
      assert.equal(read.status, "completed");
      assert.equal(read.evidence?.wait?.status, "ok");
      assert.equal(read.evidence?.jobId, "job_history");
      assert.match(read.evidence?.finalReply?.text ?? "", /无法打开/);
    } finally {
      await server.close();
    }
  });

  it("tasks.list 探针不携带 runId，history 支持 content parts", async () => {
    const frames: Array<Record<string, unknown>> = [];
    const server = await startProtocolV4Server((frame) => {
      frames.push(frame);
      if (frame.method === "connect") {
        return {
          type: "hello-ok",
          protocol: 4,
          features: { methods: ["tasks.list", "chat.history"], events: [] },
          server: { version: "x", connId: "c" },
        };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_task_params", status: "accepted" };
      }
      if (frame.method === "agent.wait") {
        return {
          runId: "gw_run_task_params",
          status: "ok",
          endedAt: "2026-07-22T00:00:00.000Z",
        };
      }
      if (frame.method === "tasks.list") {
        return {
          tasks: [
            {
              runId: "gw_run_task_params",
              status: "completed",
              terminalSummary: "新闻页面已打开",
            },
          ],
        };
      }
      if (frame.method === "chat.history") {
        return {
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "新闻页面已打开，并显示泥石流相关新闻。" }],
            },
          ],
        };
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
        idempotencyKey: "k-task-params",
        input: "open news",
        sessionKey: "lanxing-job:job_task_params",
        workspaceHint: null,
        scopes: ["desktop.control"],
        timeoutMs: null,
      });
      const read = await transport.getRun(created.runId, {
        jobId: "job_task_params",
        affairId: "affair_task_params",
        sessionKey: "lanxing-job:job_task_params",
      });

      const taskFrame = frames.find((frame) => frame.method === "tasks.list");
      const taskParams = taskFrame?.params as { runId?: string; limit?: number };
      assert.equal(taskParams.runId, undefined);
      assert.equal(taskParams.limit, 20);
      assert.equal(read.evidence?.task?.terminalOutcome, undefined);
      assert.equal(read.evidence?.task?.terminalSummary, "新闻页面已打开");
      assert.match(read.evidence?.finalReply?.text ?? "", /泥石流相关新闻/);
    } finally {
      await server.close();
    }
  });

  it("audit.activity.list 证据进入 toolFindings", async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        return {
          type: "hello-ok",
          protocol: 4,
          features: { methods: ["audit.activity.list"], events: [] },
          server: { version: "x", connId: "c" },
        };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_audit", status: "accepted" };
      }
      if (frame.method === "agent.wait") {
        return {
          runId: "gw_run_audit",
          status: "ok",
          endedAt: "2026-07-22T00:00:00.000Z",
        };
      }
      if (frame.method === "audit.activity.list") {
        return {
          activities: [
            {
              runId: "gw_run_audit",
              toolName: "browser.open",
              status: "failed",
              errorCode: "policy_blocked",
              summary: "Browser launch blocked by policy",
            },
          ],
        };
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
        idempotencyKey: "k-audit",
        input: "open news",
        sessionKey: "lanxing-job:job_audit",
        workspaceHint: null,
        scopes: ["desktop.control"],
        timeoutMs: null,
      });
      const read = await transport.getRun(created.runId, {
        jobId: "job_audit",
        affairId: "affair_audit",
        sessionKey: "lanxing-job:job_audit",
      });
      assert.equal(read.evidence?.toolFindings[0]?.status, "blocked");
      assert.equal(read.evidence?.toolFindings[0]?.toolName, "browser.open");
    } finally {
      await server.close();
    }
  });

  it("audit.activity.list 的 nested lifecycle failed 保留为 error 证据", async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") {
        return {
          type: "hello-ok",
          protocol: 4,
          features: { methods: ["audit.activity.list"], events: [] },
          server: { version: "x", connId: "c" },
        };
      }
      if (frame.method === "agent") {
        return { runId: "gw_run_lifecycle_failed", status: "accepted" };
      }
      if (frame.method === "agent.wait") {
        return {
          runId: "gw_run_lifecycle_failed",
          status: "ok",
          endedAt: "2026-07-22T00:00:00.000Z",
        };
      }
      if (frame.method === "audit.activity.list") {
        return {
          activities: [
            {
              runId: "gw_run_lifecycle_failed",
              lifecycle: {
                status: "failed",
                endedAt: "2026-07-22T00:00:00.000Z",
                terminalReason: "browser process crashed",
              },
            },
          ],
        };
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
        idempotencyKey: "k-lifecycle-failed",
        input: "open news",
        sessionKey: "lanxing-job:job_lifecycle_failed",
        workspaceHint: null,
        scopes: ["desktop.control"],
        timeoutMs: null,
      });
      const read = await transport.getRun(created.runId, {
        jobId: "job_lifecycle_failed",
        affairId: "affair_lifecycle_failed",
        sessionKey: "lanxing-job:job_lifecycle_failed",
      });
      assert.equal(read.status, "completed");
      assert.equal(read.evidence?.lifecycle?.terminalPhase, "error");
      assert.match(read.evidence?.lifecycle?.terminalReason ?? "", /crashed/);
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
