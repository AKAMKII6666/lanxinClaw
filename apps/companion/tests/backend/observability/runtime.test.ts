/** 诊断与监督投影；从原合同测试按职责拆出，用例与断言保持完整。 */
import { createEnvelope } from "@lanxin-claw/protocol";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCompanionBackendRuntime } from "../../../src/backend/runtime.js";

describe("companion backend runtime · 诊断与监督投影", () => {


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


  it("job.failed 的 statusReasonCode 进入诊断 lastError", () => {
    const backend = createCompanionBackendRuntime();
    const result = backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_diag_error" },
      target: { kind: "phone", deviceId: "phone_diag_error" },
      type: "job.failed",
      payload: {
        jobId: "job_diag_failed",
        affairId: "affair_diag_failed",
        executor: "openclaw",
        status: "failed",
        goal: "run OpenClaw",
        workspaceHint: null,
        allowedPermissions: ["workspace.read"],
        progressSummary: "missing scope",
        blockedReason: "missing scope",
        resumeCondition: null,
        statusReasonCode: "INVALID_REQUEST",
        statusObservedAt: "2026-07-22T00:00:00.000Z",
      },
    }));
    assert.equal(result.ok, true);
    const report = backend.getDiagnosticReport();
    assert.equal(report.lastError?.code, "INVALID_REQUEST");
    assert.match(report.lastError?.message ?? "", /missing scope/);
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
