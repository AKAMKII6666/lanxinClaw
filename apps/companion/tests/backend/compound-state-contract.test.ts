/**
 * 任务/权限/事务复合状态合同测试。
 *
 * 职责：覆盖 affair/job/permission 跨链的原子性与父终态门闩。
 * 不拥有：协议 server、真实 OpenClaw、renderer。
 * 副作用：仅内存。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROTOCOL_VERSION, createEnvelope, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../src/backend/runtime.js";

describe("compound affair/job/permission state contract", () => {
  it("已取消 affair 下的 job.completed 被拒绝并记录错误，不污染父终态", () => {
    const backend = createCompanionBackendRuntime();
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_terminal_job" },
      target: { kind: "companion", deviceId: "desktop_terminal_job" },
      type: "affair.create",
      payload: {
        affairId: "affair_terminal_job",
        title: "已取消事务",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: ["不被污染"],
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_terminal_job" },
      target: { kind: "phone", deviceId: "phone_terminal_job" },
      type: "job.needs_permission",
      payload: {
        jobId: "job_terminal_job",
        affairId: "affair_terminal_job",
        executor: "openclaw",
        status: "needs_permission",
        goal: "等待授权",
        allowedPermissions: ["workspace.read"],
        progressSummary: "",
        permissionRequestId: "perm_terminal_job",
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_terminal_job" },
      target: { kind: "companion", deviceId: "desktop_terminal_job" },
      type: "affair.close",
      payload: {
        affairId: "affair_terminal_job",
        title: "已取消事务",
        ownerAgent: "zhang-boss",
        status: "canceled",
        context: [],
        acceptanceCriteria: ["不被污染"],
        currentJobId: "job_terminal_job",
        blockedReason: "用户取消",
        resumeCondition: null,
      },
    })).ok, true);

    const completed = backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_terminal_job" },
      target: { kind: "phone", deviceId: "phone_terminal_job" },
      type: "job.completed",
      payload: {
        jobId: "job_terminal_job",
        affairId: "affair_terminal_job",
        executor: "openclaw",
        status: "completed",
        goal: "迟到完成",
        allowedPermissions: ["workspace.read"],
        progressSummary: "done late",
      },
    }));

    assert.equal(completed.ok, false);
    if (!completed.ok) {
      assert.equal(completed.code, "affair_terminal_for_job");
    }
    assert.equal(backend.getState().affairs.get("affair_terminal_job")?.status, "canceled");
    assert.equal(backend.getState().jobs.get("job_terminal_job")?.status, "needs_permission");
    assert.equal(backend.getState().lastError?.code, "affair_terminal_for_job");
    assert.ok(backend.getState().auditRecords.some((item) => item.outcome === "affair_terminal_for_job"));
  });

  it("已取消 affair 下的同状态 job 重放只算 duplicate，不改写 job 镜像", () => {
    const backend = createCompanionBackendRuntime();
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_terminal_replay" },
      target: { kind: "companion", deviceId: "desktop_terminal_replay" },
      type: "affair.create",
      payload: {
        affairId: "affair_terminal_replay",
        title: "重放事务",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: [],
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_terminal_replay" },
      target: { kind: "phone", deviceId: "phone_terminal_replay" },
      type: "job.needs_permission",
      payload: {
        jobId: "job_terminal_replay",
        affairId: "affair_terminal_replay",
        executor: "openclaw",
        status: "needs_permission",
        goal: "等待授权",
        allowedPermissions: ["workspace.read"],
        progressSummary: "original",
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_terminal_replay" },
      target: { kind: "companion", deviceId: "desktop_terminal_replay" },
      type: "affair.close",
      payload: {
        affairId: "affair_terminal_replay",
        title: "重放事务",
        ownerAgent: "zhang-boss",
        status: "canceled",
        context: [],
        acceptanceCriteria: [],
        currentJobId: "job_terminal_replay",
        blockedReason: "用户取消",
        resumeCondition: null,
      },
    })).ok, true);

    const replay = backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_terminal_replay" },
      target: { kind: "phone", deviceId: "phone_terminal_replay" },
      type: "job.needs_permission",
      payload: {
        jobId: "job_terminal_replay",
        affairId: "affair_terminal_replay",
        executor: "openclaw",
        status: "needs_permission",
        goal: "等待授权",
        allowedPermissions: ["workspace.write"],
        progressSummary: "rewritten",
      },
    }));

    assert.equal(replay.ok, true);
    assert.equal(replay.duplicate, true);
    assert.equal(backend.getState().jobs.get("job_terminal_replay")?.progressSummary, "original");
    assert.deepEqual(
      backend.getState().jobs.get("job_terminal_replay")?.allowedPermissions,
      ["workspace.read"],
    );
  });

  it("权限请求随父事务取消失效，旧 allow 不写 grant 也不触发 side-effect", async () => {
    let sideEffects = 0;
    const backend = createCompanionBackendRuntime({
      onBridgeAction: () => {
        sideEffects += 1;
      },
    });
    const gate = backend.getPermissionGate();
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_perm_cancel" },
      target: { kind: "companion", deviceId: "desktop_perm_cancel" },
      type: "affair.create",
      payload: {
        affairId: "affair_perm_cancel",
        title: "授权前取消",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: ["不要执行"],
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_perm_cancel" },
      target: { kind: "phone", deviceId: "phone_perm_cancel" },
      type: "job.needs_permission",
      payload: {
        jobId: "job_perm_cancel",
        affairId: "affair_perm_cancel",
        executor: "openclaw",
        status: "needs_permission",
        goal: "等待授权",
        allowedPermissions: ["secrets.read"],
        permissionRequestId: "perm_perm_cancel",
        progressSummary: "",
      },
    })).ok, true);
    assert.equal(gate.enqueue({
      permissionRequestId: "perm_perm_cancel",
      jobId: "job_perm_cancel",
      affairId: "affair_perm_cancel",
      requester: "zhang-boss",
      requestedPermissions: ["secrets.read"],
      reason: "等待授权",
      risk: "high",
      proposedScope: {},
      denyConsequence: "拒绝授权会让该 job 失败，但不等于删除整件事务。",
      requestedAt: new Date().toISOString(),
      expiresAt: null,
    }).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_perm_cancel" },
      target: { kind: "companion", deviceId: "desktop_perm_cancel" },
      type: "affair.close",
      payload: {
        affairId: "affair_perm_cancel",
        title: "授权前取消",
        ownerAgent: "zhang-boss",
        status: "canceled",
        context: [],
        acceptanceCriteria: ["不要执行"],
        currentJobId: "job_perm_cancel",
        blockedReason: "用户取消",
        resumeCondition: null,
      },
    })).ok, true);

    const allowed = await backend.applyBridgeAction({
      type: "permission.decide",
      permissionRequestId: "perm_perm_cancel",
      decision: "allow_for_job",
    });

    assert.equal(gate.getQueueStatus("perm_perm_cancel"), "expired");
    assert.equal(backend.listPendingPermissionCards().length, 0);
    assert.equal(allowed.ok, false);
    if (!allowed.ok) {
      assert.equal(allowed.error.code, "permission_expired");
    }
    assert.equal(sideEffects, 0);
    assert.equal(gate.hasGrant("job_perm_cancel", "secrets.read"), false);
  });

  it("affair.cancel 对 needs_permission 是复合动作：先取消 job 并失效权限，再关闭事务", async () => {
    const sent: ProtocolEnvelope[] = [];
    let backend!: ReturnType<typeof createCompanionBackendRuntime>;
    backend = createCompanionBackendRuntime({
      desktopDeviceId: "desktop_cancel_compound",
      onBridgeAction: async (action, result) => {
        const { runShellBridgeAction } = await import("../../src/shell/desktop/bridge-outbound.js");
        await runShellBridgeAction(
          {
            desktopDeviceId: "desktop_cancel_compound",
            backend,
            getDelegator: () => null,
            broadcast: (envelope) => {
              sent.push(envelope);
              return backend.applyProtocolEnvelope(envelope);
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
      source: { kind: "phone", deviceId: "phone_cancel_compound" },
      target: { kind: "companion", deviceId: "desktop_cancel_compound" },
      type: "session.open",
      payload: {
        sessionId: "sess_cancel_compound",
        phoneDeviceId: "phone_cancel_compound",
        desktopDeviceId: "desktop_cancel_compound",
        authProof: "proof_cancel_compound",
        protocolVersion: PROTOCOL_VERSION,
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_cancel_compound" },
      target: { kind: "companion", deviceId: "desktop_cancel_compound" },
      type: "affair.create",
      payload: {
        affairId: "affair_cancel_compound",
        title: "取消等待授权事务",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: ["不执行"],
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_cancel_compound" },
      target: { kind: "phone", deviceId: "phone_cancel_compound" },
      type: "job.needs_permission",
      payload: {
        jobId: "job_cancel_compound",
        affairId: "affair_cancel_compound",
        executor: "openclaw",
        status: "needs_permission",
        goal: "等待授权后执行",
        allowedPermissions: ["workspace.read"],
        permissionRequestId: "perm_cancel_compound",
        progressSummary: "",
      },
    })).ok, true);
    assert.equal(backend.getPermissionGate().enqueue({
      permissionRequestId: "perm_cancel_compound",
      jobId: "job_cancel_compound",
      affairId: "affair_cancel_compound",
      requester: "zhang-boss",
      requestedPermissions: ["workspace.read"],
      reason: "等待授权后执行",
      risk: "low",
      proposedScope: {},
      denyConsequence: "拒绝授权会让该 job 失败，但不等于删除整件事务。",
      requestedAt: new Date().toISOString(),
      expiresAt: null,
    }).ok, true);

    const result = await backend.applyBridgeAction({
      type: "affair.cancel",
      affairId: "affair_cancel_compound",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(sent.map((item) => item.type), ["job.canceled", "affair.close"]);
    assert.equal(backend.getState().jobs.get("job_cancel_compound")?.status, "canceled");
    assert.equal(backend.getState().affairs.get("affair_cancel_compound")?.status, "canceled");
    assert.equal(backend.getPermissionGate().getQueueStatus("perm_cancel_compound"), "expired");
    assert.equal(backend.listPendingPermissionCards().length, 0);
  });
});
