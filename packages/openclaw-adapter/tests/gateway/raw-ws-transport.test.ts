/**
 * raw WebSocket Gateway transport 契约。
 *
 * 职责：验证 Gateway connect/req/res 线协议、状态映射与错误 fail-closed。
 * 不拥有：真实 OpenClaw Gateway、官方 SDK 发布状态、Lanxing permission gate。
 * 副作用：监听本机随机 WebSocket 端口。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocketServer } from "ws";
import { createRawWebSocketGatewayTransport, GatewayTransportError } from "../../src/index.js";

describe("raw websocket gateway transport", () => {
  it("发送 connect 和 runs.create/get/cancel RPC，并规范化状态", async () => {
    const frames: Array<Record<string, unknown>> = [];
    const server = await startRpcServer((frame) => {
      frames.push(frame);
      if (frame.type === "connect") {
        return null;
      }
      if (frame.method === "runs.create") {
        return { runId: "gw_run_001", status: "accepted", summary: "accepted by gateway" };
      }
      if (frame.method === "runs.get") {
        return { id: "gw_run_001", state: "approval_required", blockedReason: "needs approval" };
      }
      if (frame.method === "runs.cancel") {
        return { runId: "gw_run_001", status: "aborted" };
      }
      throw new Error("unexpected method");
    });
    try {
      const transport = createRawWebSocketGatewayTransport({
        gatewayUrl: server.url,
        authProvider: () => "token-test",
        timeoutMs: 1000,
      });
      const created = await transport.createRun({
        agentId: "agent_001",
        input: "read only",
        sessionKey: "job_001",
        workspaceHint: "F:/workspace/demo",
        scopes: ["workspace.read"],
        timeoutMs: null,
      });
      const read = await transport.getRun("gw_run_001");
      const canceled = await transport.cancelRun("gw_run_001");

      assert.equal(created.status, "accepted");
      assert.equal(read.status, "waiting_approval");
      assert.equal(canceled.status, "cancelled");
      assert.equal(frames[0]?.type, "connect");
      assert.equal(frames.some((frame) => frame.method === "runs.create"), true);
      assert.equal(frames.some((frame) => frame.method === "runs.get"), true);
      assert.equal(frames.some((frame) => frame.method === "runs.cancel"), true);
    } finally {
      await server.close();
    }
  });

  it("Gateway RPC 错误保留 code/retryable，不回退 fake", async () => {
    const server = await startRpcServer((frame) => {
      if (frame.type === "connect") {
        return null;
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
});

/**
 * 启动最小 Gateway RPC server。
 */
async function startRpcServer(
  handler: (frame: Record<string, unknown>) => unknown,
): Promise<{ url: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type !== "req") {
        handler(frame);
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
