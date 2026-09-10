/** Gateway 取消携证契约：隔离 owner scope、目标匹配、停止结果与完成竞争。仅监听本机测试端口。 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { createRawWebSocketGatewayTransport, GatewayTransportError } from "../../../src/index.js";
import { startProtocolV4Server } from "../support/protocol-v4.js";

it("自托管 admin 仅用于取消连接，普通 create/read 不扩大 scope", async () => {
  const scopes: unknown[] = [];
  let aborted = false;
  const server = await startProtocolV4Server((frame) => {
    if (frame.method === "connect") {
      scopes.push((frame.params as Record<string, unknown>).scopes);
      return { type: "hello-ok" };
    }
    if (frame.method === "chat.abort") {
      aborted = true;
      return { ok: true, aborted: true, runIds: ["run-owner"] };
    }
    return { runId: "run-owner", status: aborted ? "error" : "running", ...(aborted ? { stopReason: "aborted", endedAt: Date.now() } : {}) };
  });
  try {
    const transport = createRawWebSocketGatewayTransport({
      gatewayUrl: server.url, authProvider: () => "test-token", allowAdminAbort: true,
    });
    await transport.createRun({ input: "read", sessionKey: "lanxing-job:owner", workspaceHint: null, scopes: [], timeoutMs: null });
    await transport.getRun("run-owner");
    const canceled = await transport.cancelRun("run-owner");
    assert.equal(canceled.status, "cancelled");
    assert.equal(canceled.evidence?.localCancelAck, true);
    assert.deepEqual(scopes, [
      ["operator.read", "operator.write"], ["operator.read", "operator.write"],
      ["operator.read", "operator.write", "operator.admin"],
      ["operator.read", "operator.write"],
    ]);
  } finally { await server.close(); }
});

it("自托管取消不允许向非 loopback Gateway 申请 admin", async () => {
  const transport = createRawWebSocketGatewayTransport({
    gatewayUrl: "ws://192.0.2.1:18789", authProvider: () => "test-token", allowAdminAbort: true,
  });
  await assert.rejects(transport.cancelRun("run-owner"), {
    code: "gateway_admin_abort_requires_loopback", retryable: false,
  });
});

for (const fixture of [
  { name: "只有 ok", ack: { ok: true } },
  { name: "另一个 run", ack: { ok: true, aborted: true, runIds: ["other-run"] } },
  { name: "多个 run", ack: { ok: true, aborted: true, runIds: ["run-target", "other-run"] } },
  { name: "否定却带目标", ack: { ok: true, aborted: false, runIds: ["run-target"] } },
  { name: "无活动 run 但读取仍运行", ack: { ok: true, aborted: false, runIds: [] }, wait: { runId: "run-target", status: "running" } },
  { name: "读取了另一个已结束 run", ack: { ok: true, aborted: false, runIds: [] }, wait: { runId: "other-run", status: "completed" } },
  { name: "已接受 abort 但执行尚未停止", ack: { ok: true, aborted: true, runIds: ["run-target"] }, wait: { runId: "run-target", status: "timeout", timeoutPhase: "gateway_draining" } },
]) {
  it(`取消不能用不完整或错目标回执制造终态：${fixture.name}`, async () => {
    const server = await startProtocolV4Server((frame) => {
      if (frame.method === "connect") return { type: "hello-ok" };
      if (frame.method === "chat.abort") return fixture.ack;
      return fixture.wait;
    });
    try {
      const transport = createRawWebSocketGatewayTransport({ gatewayUrl: server.url, authProvider: () => "test-token" });
      await assert.rejects(transport.cancelRun("run-target"), (error) =>
        error instanceof GatewayTransportError && error.code === "gateway_cancel_unconfirmed" && error.retryable);
    } finally { await server.close(); }
  });
}

it("取消与自然完成竞争时保留原 completed 事实，不伪造 canceled", async () => {
  const server = await startProtocolV4Server((frame) => {
    if (frame.method === "connect") return { type: "hello-ok" };
    if (frame.method === "chat.abort") return { ok: true, aborted: false, runIds: [] };
    return { runId: "run-finished", status: "completed", endedAt: "2026-09-11T00:00:00Z", summary: "原执行结果" };
  });
  try {
    const transport = createRawWebSocketGatewayTransport({ gatewayUrl: server.url, authProvider: () => "test-token" });
    const result = await transport.cancelRun("run-finished");
    assert.equal(result.status, "completed");
    assert.equal(result.summary, "原执行结果");
    assert.equal(result.evidence?.localCancelAck, undefined);
  } finally { await server.close(); }
});
