/**
 * 真实控制面板投影测试。
 *
 * 职责：验证任务页、张老板页、权限页和诊断报告可由真实 snapshot/pending 数据生成。
 * 不拥有：React 渲染、Electron IPC、真实 Gateway。
 * 副作用：仅内存。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../../src/backend/runtime.js";
import { projectZhangBossPanelFromSnapshot } from "../../../src/chat/snapshot-panel-state.js";
import { projectPermissionPanelFromSnapshot } from "../../../src/permissions/snapshot-panel-state.js";
import { projectTaskWorkspaceFromSnapshot } from "../../../src/ui/pages/tasks/tasks-projection.js";

describe("real UI projections", () => {
  it("任务页/张老板页从真实 snapshot 投影，不依赖 demo affair", () => {
    const backend = createCompanionBackendRuntime();
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_proj_001" },
      target: { kind: "companion", deviceId: "desktop_proj_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_projection_001",
        title: "真实投影事务",
        ownerAgent: "zhang-boss",
        status: "running",
        context: ["真实上下文"],
        acceptanceCriteria: ["真实验收"],
        currentJobId: "job_projection_001",
      },
    }));
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_proj_001" },
      target: { kind: "phone", deviceId: "phone_proj_001" },
      type: "job.completed",
      payload: {
        jobId: "job_projection_001",
        affairId: "affair_projection_001",
        executor: "openclaw",
        status: "completed",
        goal: "真实 job",
        allowedPermissions: ["workspace.read"],
        progressSummary: "真实 worker 已完成",
      },
    }));

    const snapshot = backend.getSnapshot();
    const tasks = projectTaskWorkspaceFromSnapshot(snapshot, null);
    const zhangBoss = projectZhangBossPanelFromSnapshot(snapshot);

    assert.equal(tasks.affairs[0]?.affairId, "affair_projection_001");
    assert.equal(tasks.selectedDetail?.status, "waiting_acceptance");
    assert.equal(tasks.selectedDetail?.currentJob?.status, "completed");
    assert.equal(zhangBoss.currentAffair?.title, "真实投影事务");
    assert.equal(zhangBoss.currentAffair?.progressSummary, "真实 worker 已完成");
  });

  it("权限页从真实 pending cards 投影，并且诊断报告不含 secret/token", () => {
    const backend = createCompanionBackendRuntime();
    const gate = backend.getPermissionGate();
    const enqueued = gate.enqueue({
      permissionRequestId: "perm_projection_001",
      jobId: "job_projection_002",
      affairId: "affair_projection_002",
      requester: "zhang-boss",
      requestedPermissions: ["workspace.read"],
      reason: "真实权限请求",
      risk: "low",
      proposedScope: { workspaceRoot: "F:/workspace/demo" },
      denyConsequence: "job 停在 needs_permission",
      requestedAt: new Date().toISOString(),
      expiresAt: null,
    });
    assert.equal(enqueued.ok, true);

    const panel = projectPermissionPanelFromSnapshot(
      backend.getSnapshot(),
      backend.listPendingPermissionCards(),
    );
    const report = backend.getDiagnosticReport();
    const reportText = JSON.stringify(report).toLowerCase();

    assert.equal(panel.pendingCards[0]?.permissionRequestId, "perm_projection_001");
    assert.equal(panel.currentJobId, "job_projection_002");
    assert.equal(report.services.some((item) => item.probeId === "openclaw.gateway"), true);
    assert.equal(reportText.includes("secret"), false);
    assert.equal(reportText.includes("token"), false);
  });
});
