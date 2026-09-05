/**
 * Companion backend runtime 测试。
 *
 * 职责：验证协议事件进入真实 store 后可投影 snapshot，且状态机 fail-closed。
 * 不拥有：WebSocket server、真实 OpenClaw Gateway、renderer UI。
 * 副作用：仅内存。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROTOCOL_VERSION, createEnvelope } from "@lanxin-claw/protocol";
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

  it("job.needs_permission 会把 ready affair 推进为 delegated 并暴露等待授权 job", () => {
    const backend = createCompanionBackendRuntime();
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_backend_perm",
        title: "联网查新闻",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: ["查到结果或说明失败原因"],
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_001" },
      target: { kind: "phone", deviceId: "phone_001" },
      type: "job.needs_permission",
      payload: {
        jobId: "job_backend_perm",
        affairId: "affair_backend_perm",
        executor: "openclaw",
        status: "needs_permission",
        goal: "联网查新闻",
        allowedPermissions: ["workspace.read", "network.access"],
        progressSummary: "",
        permissionRequestId: "perm_backend_perm",
      },
    })).ok, true);

    const snapshot = backend.getSnapshot();
    assert.equal(snapshot.currentAffair?.affairId, "affair_backend_perm");
    assert.equal(snapshot.currentAffair?.status, "delegated");
    assert.equal(snapshot.currentAffair?.currentJobId, "job_backend_perm");
    assert.equal(snapshot.currentAffair?.currentJobStatus, "needs_permission");
    assert.equal(snapshot.affairs?.length, 1);
  });

  it("hydrate mirror 后从 job 反推修复 stuck ready affair", () => {
    const backend = createCompanionBackendRuntime({
      mirrorStore: {
        load: () => ({
          schemaVersion: 1 as const,
          affairs: [{
            affairId: "affair_stuck_ready",
            title: "真实事故事务",
            ownerAgent: "zhang-boss",
            status: "ready",
            context: [],
            acceptanceCriteria: ["显示最终状态"],
            currentJobId: null,
            blockedReason: null,
            resumeCondition: null,
          }],
          jobs: [{
            jobId: "job_stuck_completed",
            affairId: "affair_stuck_ready",
            executor: "openclaw",
            status: "completed",
            purpose: "execution",
            goal: "查新闻",
            workspaceHint: null,
            allowedPermissions: ["workspace.read", "network.access"],
            progressSummary: "查找已结束",
            blockedReason: null,
            resumeCondition: null,
            permissionRequestId: "perm_stuck",
          }],
          chatMessages: [],
          contextAttachments: [],
          pendingContext: [],
        }),
        save: () => {},
      },
    });

    const snapshot = backend.getSnapshot();
    assert.equal(snapshot.currentAffair?.status, "waiting_acceptance");
    assert.equal(snapshot.currentAffair?.currentJobId, "job_stuck_completed");
    assert.equal(snapshot.currentAffair?.currentJobStatus, "completed");
    assert.equal(snapshot.currentAffair?.progressSummary, "查找已结束");
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

  it("job.canceled 不自动取消整件 affair，只投影为 blocked 等待裁决", () => {
    const backend = createCompanionBackendRuntime();
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_cancel_projection" },
      target: { kind: "companion", deviceId: "desktop_cancel_projection" },
      type: "affair.create",
      payload: {
        affairId: "affair_cancel_projection",
        title: "执行被取消",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: ["用户裁决"],
        currentJobId: "job_cancel_projection",
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_cancel_projection" },
      target: { kind: "phone", deviceId: "phone_cancel_projection" },
      type: "job.canceled",
      payload: {
        jobId: "job_cancel_projection",
        affairId: "affair_cancel_projection",
        executor: "openclaw",
        status: "canceled",
        purpose: "execution",
        goal: "cancel projection",
        workspaceHint: null,
        allowedPermissions: ["workspace.read"],
        progressSummary: "OpenClaw cancel ack",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      },
    })).ok, true);

    const affair = backend.getState().affairs.get("affair_cancel_projection");
    assert.equal(affair?.status, "blocked");
    assert.equal(affair?.blockedReason, "last_execution_canceled");
    assert.equal(affair?.resumeCondition, "需要用户或张老板决定是否重新委派或取消事务");
  });

  it("事务 bridge 动作先做本地状态与 session 校验", async () => {
    const backend = createCompanionBackendRuntime();
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_bridge_state" },
      target: { kind: "companion", deviceId: "desktop_bridge_state" },
      type: "affair.create",
      payload: {
        affairId: "affair_bridge_state",
        title: "验收前置校验",
        ownerAgent: "zhang-boss",
        status: "waiting_acceptance",
        context: [],
        acceptanceCriteria: ["明确接受"],
        currentJobId: "job_bridge_state",
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_bridge_state" },
      target: { kind: "phone", deviceId: "phone_bridge_state" },
      type: "job.completed",
      payload: {
        jobId: "job_bridge_state",
        affairId: "affair_bridge_state",
        executor: "openclaw",
        status: "completed",
        goal: "完成一件事",
        allowedPermissions: ["workspace.read"],
        progressSummary: "任务已完成",
      },
    })).ok, true);

    const noSession = await backend.applyBridgeAction({
      type: "affair.accept",
      affairId: "affair_bridge_state",
    });
    assert.equal(noSession.ok, false);
    if (!noSession.ok) {
      assert.equal(noSession.error.code, "session_required");
    }

    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_bridge_state" },
      target: { kind: "companion", deviceId: "desktop_bridge_state" },
      type: "session.open",
      payload: {
        sessionId: "sess_bridge_state",
        phoneDeviceId: "phone_bridge_state",
        desktopDeviceId: "desktop_bridge_state",
        authProof: "proof_bridge_state",
        protocolVersion: PROTOCOL_VERSION,
      },
    })).ok, true);

    const accepted = await backend.applyBridgeAction({
      type: "affair.accept",
      affairId: "affair_bridge_state",
    });
    assert.equal(accepted.ok, true);
    assert.ok(backend.getState().auditRecords.some((item) => item.kindLabel === "验收"));
  });

  it("离线 requestAcceptance 通过状态门闩并可由 shell 排队给张老板", async () => {
    const sent: ProtocolEnvelope[] = [];
    const backend = createCompanionBackendRuntime({
      desktopDeviceId: "desktop_bridge_queue",
      onBridgeAction: async (action, result) => {
        const { runShellBridgeAction } = await import("../../src/shell/desktop/bridge-outbound.js");
        await runShellBridgeAction(
          {
            desktopDeviceId: "desktop_bridge_queue",
            backend,
            getDelegator: () => null,
            broadcast: (envelope) => {
              sent.push(envelope);
            },
            approvePairing: null,
            openLogDir: () => undefined,
            logger: {
              info: () => undefined,
              warn: () => undefined,
              error: () => undefined,
            } as never,
          },
          action,
          result,
        );
      },
    });
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_bridge_queue" },
      target: { kind: "companion", deviceId: "desktop_bridge_queue" },
      type: "affair.create",
      payload: {
        affairId: "affair_bridge_queue",
        title: "请求张老板回报",
        ownerAgent: "zhang-boss",
        status: "waiting_acceptance",
        context: [],
        acceptanceCriteria: ["说明状态"],
        currentJobId: "job_bridge_queue",
      },
    })).ok, true);

    const result = await backend.applyBridgeAction({
      type: "affair.requestAcceptance",
      affairId: "affair_bridge_queue",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.delivery?.status, "queued_until_session");
      assert.equal(result.delivery?.reasonCode, "session_not_authenticated");
    }
    assert.equal(sent.length, 0);
    assert.equal(backend.getPendingContext().list().length, 1);
    assert.equal(backend.getSnapshot().recentActionDeliveries?.[0]?.status, "queued_until_session");
    assert.ok(backend.getState().auditRecords.some((item) =>
      item.kindLabel === "验收" && item.outcome === "queued_until_session"
    ));
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
