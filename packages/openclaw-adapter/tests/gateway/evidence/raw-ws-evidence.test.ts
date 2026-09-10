/** 多源运行证据；从原合同测试按职责拆出，用例与断言保持完整。 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
createRawWebSocketGatewayTransport,
GatewayTransportError,
} from "../../../src/index.js";
import { startProtocolV4Server } from "../support/protocol-v4.js";

describe("raw websocket gateway transport (protocol v4) · 多源运行证据", () => {


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
});
