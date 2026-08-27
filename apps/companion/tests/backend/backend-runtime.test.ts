/**
 * Companion backend runtime 测试。
 *
 * 职责：验证协议事件进入真实 store 后可投影 snapshot，且状态机 fail-closed。
 * 不拥有：WebSocket server、真实 OpenClaw Gateway、renderer UI。
 * 副作用：仅内存。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../src/backend/runtime.js";

describe("companion backend runtime", () => {
  it("affair/job 事件进入 store 后更新 snapshot，completed 只到 waiting_acceptance", () => {
    const backend = createCompanionBackendRuntime();
    const affair = createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_backend_001",
        title: "修复项目问题",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: ["测试通过"],
        currentJobId: "job_backend_001",
      },
    });
    const job = createEnvelope({
      source: { kind: "companion", deviceId: "desktop_001" },
      target: { kind: "phone", deviceId: "phone_001" },
      type: "job.completed",
      payload: {
        jobId: "job_backend_001",
        affairId: "affair_backend_001",
        executor: "openclaw",
        status: "completed",
        goal: "run tests",
        allowedPermissions: ["workspace.read"],
        progressSummary: "done",
      },
    });
    assert.equal(backend.applyProtocolEnvelope(affair).ok, true);
    assert.equal(backend.applyProtocolEnvelope(job).ok, true);
    const snapshot = backend.getSnapshot();
    assert.equal(snapshot.currentAffair?.status, "waiting_acceptance");
    assert.equal(snapshot.currentAffair?.progressSummary, "done");
    assert.ok(backend.getState().auditRecords.some((item) => item.summary.includes("job.completed")));
  });

  it("非法状态迁移被拒绝，重复 messageId 幂等", () => {
    const backend = createCompanionBackendRuntime();
    const closed = createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_backend_002",
        title: "已关闭事务",
        ownerAgent: "zhang-boss",
        status: "closed",
        context: [],
        acceptanceCriteria: ["用户验收"],
      },
    });
    const reopened = createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "affair.update",
      payload: {
        affairId: "affair_backend_002",
        title: "已关闭事务",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: ["用户验收"],
      },
    });
    assert.equal(backend.applyProtocolEnvelope(closed).ok, true);
    assert.equal(backend.applyProtocolEnvelope(closed).duplicate, true);
    const result = backend.applyProtocolEnvelope(reopened);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "affair_illegal_transition");
    }
  });

  it("job.cancel 作为独立事件进入 store，不需要完整 JobPayload", () => {
    const backend = createCompanionBackendRuntime();
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "job.create",
      payload: {
        jobId: "job_cancel_store_001",
        affairId: "affair_cancel_store_001",
        executor: "openclaw",
        status: "queued",
        goal: "cancel me",
        allowedPermissions: ["workspace.read"],
      },
    })).ok, true);

    const canceled = backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "job.cancel",
      payload: {
        jobId: "job_cancel_store_001",
        affairId: "affair_cancel_store_001",
      },
    }));
    assert.equal(canceled.ok, true);
    assert.equal(backend.getState().jobs.get("job_cancel_store_001")?.status, "canceled");
  });

  it("diagnostics 使用注入的真实 readiness 输入，不用 job 数量推断 Gateway", () => {
    const backend = createCompanionBackendRuntime({
      diagnosticsInput: () => ({
        protocolServerReady: true,
        gatewayReady: false,
        gatewayUrl: "ws://127.0.0.1:18888",
        lanDiscoveryReady: true,
        secureStorageReady: true,
      }),
    });
    backend.getState().jobs.set("job_diag_001", {
      jobId: "job_diag_001",
      affairId: "affair_diag_001",
      executor: "openclaw",
      status: "completed",
      goal: "done",
      workspaceHint: null,
      allowedPermissions: ["workspace.read"],
      progressSummary: "done",
      blockedReason: null,
      resumeCondition: null,
      permissionRequestId: null,
    });
    const report = backend.getDiagnosticReport();
    const gateway = report.services.find((item) => item.probeId === "openclaw.gateway");
    assert.equal(gateway?.status, "warn");
    assert.match(gateway?.detail ?? "", /configured but not ready/);
  });

  it("监督 loop：job 已完成但 affair 仍 running 时推到 waiting_acceptance，不写 closed", async () => {
    const backend = createCompanionBackendRuntime({ supervisionIntervalMs: 20 });
    try {
      assert.equal(backend.applyProtocolEnvelope(createEnvelope({
        source: { kind: "phone", deviceId: "phone_sup_001" },
        target: { kind: "companion", deviceId: "desktop_sup_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_sup_001",
          title: "监督接线",
          ownerAgent: "zhang-boss",
          status: "running",
          context: [],
          acceptanceCriteria: ["验收"],
          currentJobId: "job_sup_001",
        },
      })).ok, true);
      assert.equal(backend.applyProtocolEnvelope(createEnvelope({
        source: { kind: "phone", deviceId: "phone_sup_001" },
        target: { kind: "companion", deviceId: "desktop_sup_001" },
        type: "job.create",
        payload: {
          jobId: "job_sup_001",
          affairId: "affair_sup_001",
          executor: "openclaw",
          status: "queued",
          goal: "监督",
          allowedPermissions: ["workspace.read"],
        },
      })).ok, true);
      const job = backend.getState().jobs.get("job_sup_001");
      assert.ok(job);
      job.status = "completed";
      job.progressSummary = "worker done";
      const start = Date.now();
      while (backend.getState().affairs.get("affair_sup_001")?.status !== "waiting_acceptance") {
        if (Date.now() - start > 2000) {
          throw new Error("supervision timeout");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(backend.getState().affairs.get("affair_sup_001")?.status, "waiting_acceptance");
      assert.notEqual(backend.getState().affairs.get("affair_sup_001")?.status, "closed");
    } finally {
      backend.stopSupervision();
    }
  });

  it("snapshotExtras 投影真实 Gateway 状态", () => {
    const backend = createCompanionBackendRuntime({
      snapshotExtras: () => ({
        clawCore: {
          status: "running",
          version: "test",
          adapterReady: true,
          message: "Gateway 运行中",
        },
      }),
    });
    const snapshot = backend.getSnapshot();
    assert.equal(snapshot.clawCore.status, "running");
    assert.equal(snapshot.clawCore.adapterReady, true);
  });

  it("总览优先 blocked 而非 running", () => {
    const backend = createCompanionBackendRuntime();
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_pri_001" },
      target: { kind: "companion", deviceId: "desktop_pri_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_pri_run",
        title: "运行中",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: [],
      },
    }));
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_pri_001" },
      target: { kind: "companion", deviceId: "desktop_pri_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_pri_block",
        title: "阻塞",
        ownerAgent: "zhang-boss",
        status: "blocked",
        context: [],
        acceptanceCriteria: [],
        blockedReason: "缺权限",
        resumeCondition: "授权后 resume",
      },
    }));
    assert.equal(backend.getSnapshot().currentAffair?.affairId, "affair_pri_block");
  });
});
