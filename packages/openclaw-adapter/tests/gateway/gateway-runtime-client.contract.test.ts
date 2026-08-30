/**
 * Gateway runtime client 契约测试。
 *
 * 职责：证明 Gateway client 实现 OpenClawRuntimeClient 窄接口且 fail-closed。
 * 不拥有：真实 Gateway 联调、companion 权限裁决、affair 关闭。
 * 副作用：仅 fake transport 内存状态。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OpenClawAdapter,
  createFakeGatewayTransport,
  createGatewayRuntimeClient,
  createUnavailableGatewayTransport,
} from "../../src/index.js";

describe("gateway runtime client contract", () => {
  it("create/read/cancel 通过 fake transport 并保持 sessionKey 绑定 job", async () => {
    const fake = createFakeGatewayTransport();
    const runtime = createGatewayRuntimeClient({
      gatewayUrl: "ws://127.0.0.1:18789",
      agentId: "main",
      defaultScopes: ["workspace.read"],
      authProvider: () => "test-token",
      transport: fake.transport,
      timeoutMs: 1000,
    });
    const adapter = new OpenClawAdapter({ runtime });

    const created = await adapter.createJob({
      jobId: "job_gateway_001",
      affairId: "affair_gateway_001",
      goal: "Gateway readonly smoke",
      workspaceHint: "F:/workspace/demo",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    assert.equal(fake.createdRequests[0]?.sessionKey, "lanxing-job:job_gateway_001");
    assert.deepEqual(fake.createdRequests[0]?.scopes, ["workspace.read"]);

    if (!created.ok) {
      return;
    }
    fake.advance(created.job.openclawRunId ?? "", {
      status: "completed",
      summary: "gateway done",
    });
    const read = await adapter.readJob("job_gateway_001");
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.job.status, "completed");
      assert.equal(read.job.progressSummary, "gateway done");
    }

    const canceled = await adapter.cancelJob("job_gateway_001");
    assert.equal(canceled.ok, true);
    if (canceled.ok) {
      assert.equal(canceled.job.status, "completed");
    }
  });

  it("缺少 Gateway 配置或鉴权时 fail-closed", async () => {
    const fake = createFakeGatewayTransport();
    const missingUrl = createGatewayRuntimeClient({
      gatewayUrl: "",
      agentId: "main",
      defaultScopes: ["workspace.read"],
      authProvider: () => "test-token",
      transport: fake.transport,
    });
    await assert.rejects(
      () => missingUrl.createRun({ input: "x" }),
      /gateway_url_missing/,
    );

    const missingScope = createGatewayRuntimeClient({
      gatewayUrl: "ws://127.0.0.1:18789",
      agentId: "main",
      defaultScopes: [],
      authProvider: () => "test-token",
      transport: fake.transport,
    });
    await assert.rejects(
      () => missingScope.createRun({ input: "x" }),
      /gateway_scope_missing/,
    );

    const missingAuth = createGatewayRuntimeClient({
      gatewayUrl: "ws://127.0.0.1:18789",
      agentId: "main",
      defaultScopes: ["workspace.read"],
      transport: fake.transport,
    });
    await assert.rejects(
      () => missingAuth.createRun({ input: "x" }),
      /gateway_auth_missing/,
    );
  });

  it("adapter 保留 Gateway 配置错误码与 retryable=false", async () => {
    const runtime = createGatewayRuntimeClient({
      gatewayUrl: "",
      agentId: "main",
      defaultScopes: ["workspace.read"],
      authProvider: () => "test-token",
      transport: createFakeGatewayTransport().transport,
    });
    const adapter = new OpenClawAdapter({ runtime });
    const created = await adapter.createJob({
      jobId: "job_gateway_error_001",
      affairId: "affair_gateway_error_001",
      goal: "Gateway error shape",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, false);
    if (!created.ok) {
      assert.equal(created.code, "gateway_url_missing");
      assert.equal(created.retryable, false);
    }
  });

  it("createRun 优先使用 job 级 allowedPermissions 作为 scope 摘要", async () => {
    const fake = createFakeGatewayTransport();
    const runtime = createGatewayRuntimeClient({
      gatewayUrl: "ws://127.0.0.1:18789",
      agentId: "main",
      defaultScopes: ["workspace.read", "command.run"],
      authProvider: () => "test-token",
      transport: fake.transport,
    });
    const adapter = new OpenClawAdapter({ runtime });
    const created = await adapter.createJob({
      jobId: "job_gateway_scope_001",
      affairId: "affair_gateway_scope_001",
      goal: "Gateway scope boundary",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    assert.deepEqual(fake.createdRequests[0]?.scopes, ["workspace.read"]);
  });

  it("未注入 transport 时默认 raw WS，失败也不回退 mock", async () => {
    const runtime = createGatewayRuntimeClient({
      gatewayUrl: "ws://127.0.0.1:18789",
      agentId: "main",
      defaultScopes: ["workspace.read"],
      authProvider: () => "test-token",
      timeoutMs: 100,
    });
    await assert.rejects(
      () => runtime.createRun({ input: "x" }),
      /Gateway|ECONNREFUSED|连接/,
    );

    const unavailable = createUnavailableGatewayTransport("Gateway 未启动");
    await assert.rejects(
      () => unavailable.getRun("run_001"),
      /Gateway 未启动/,
    );
  });

  it("取消后迟到 completed 不复活 canceled job", async () => {
    const fake = createFakeGatewayTransport();
    const runtime = createGatewayRuntimeClient({
      gatewayUrl: "ws://127.0.0.1:18789",
      agentId: "main",
      defaultScopes: ["workspace.read"],
      authProvider: () => "test-token",
      transport: fake.transport,
    });
    const adapter = new OpenClawAdapter({ runtime });
    const created = await adapter.createJob({
      jobId: "job_gateway_cancel_001",
      affairId: "affair_gateway_001",
      goal: "Gateway cancellable",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    const runId = created.job.openclawRunId ?? "";
    const canceled = await adapter.cancelJob("job_gateway_cancel_001");
    assert.equal(canceled.ok, true);
    if (canceled.ok) {
      assert.equal(canceled.job.status, "canceled");
    }

    fake.advance(runId, { status: "completed", summary: "late done" });
    const read = await adapter.readJob("job_gateway_cancel_001");
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.job.status, "canceled");
      assert.notEqual(read.job.progressSummary, "late done");
    }
  });
});
