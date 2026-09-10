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
    assert.deepEqual(tasks.selectedDetail?.acceptanceCriteria, ["真实验收"]);
    assert.deepEqual(tasks.selectedDetail?.context, ["真实上下文"]);
    assert.equal(tasks.selectedDetail?.currentJob?.status, "completed");
    assert.equal(tasks.selectedDetail?.currentJob?.goal, "真实 job");
    assert.equal(zhangBoss.currentAffair?.title, "真实投影事务");
    assert.equal(zhangBoss.currentAffair?.progressSummary, "真实 worker 已完成");
  });

  it("任务页从 snapshot.affairs 展示多个非终态事务与真实 job 状态", () => {
    const backend = createCompanionBackendRuntime();
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_proj_001" },
      target: { kind: "companion", deviceId: "desktop_proj_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_projection_old",
        title: "旧事务",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: [],
        currentJobId: "job_projection_old",
      },
    }));
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_proj_001" },
      target: { kind: "companion", deviceId: "desktop_proj_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_projection_wait_perm",
        title: "等授权事务",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: ["授权后执行"],
      },
    }));
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_proj_001" },
      target: { kind: "phone", deviceId: "phone_proj_001" },
      type: "job.needs_permission",
      payload: {
        jobId: "job_projection_wait_perm",
        affairId: "affair_projection_wait_perm",
        executor: "openclaw",
        status: "needs_permission",
        goal: "等待桌面授权",
        workspaceHint: null,
        allowedPermissions: ["workspace.read"],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: "perm_projection_wait_perm",
      },
    }));

    const tasks = projectTaskWorkspaceFromSnapshot(backend.getSnapshot(), "affair_projection_wait_perm");
    assert.equal(tasks.affairs.length, 2);
    assert.equal(tasks.selectedDetail?.affairId, "affair_projection_wait_perm");
    assert.equal(tasks.selectedDetail?.status, "delegated");
    assert.equal(tasks.selectedDetail?.currentJob?.status, "needs_permission");
  });

  it("任务页不会把 OpenClaw 低层 stop 当成上下文或已尝试步骤", () => {
    const backend = createCompanionBackendRuntime();
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_proj_001" },
      target: { kind: "companion", deviceId: "desktop_proj_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_projection_stop",
        title: "查新闻",
        ownerAgent: "zhang-boss",
        status: "running",
        context: ["用户要查尼泊尔泥石流新闻"],
        acceptanceCriteria: ["页面上显示新闻内容"],
        currentJobId: "job_projection_stop",
      },
    }));
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_proj_001" },
      target: { kind: "phone", deviceId: "phone_proj_001" },
      type: "job.completed",
      payload: {
        jobId: "job_projection_stop",
        affairId: "affair_projection_stop",
        executor: "openclaw",
        status: "completed",
        goal: "打开浏览器查新闻",
        allowedPermissions: ["desktop.control"],
        progressSummary: "stop",
      },
    }));

    const tasks = projectTaskWorkspaceFromSnapshot(backend.getSnapshot(), null);

    assert.equal(tasks.selectedDetail?.status, "waiting_acceptance");
    assert.deepEqual(tasks.selectedDetail?.context, ["用户要查尼泊尔泥石流新闻"]);
    assert.deepEqual(tasks.selectedDetail?.currentJob?.attemptedSteps, []);
    assert.equal(tasks.selectedDetail?.currentJob?.progressSummary, "电脑端执行已结束，等待你确认结果");
  });

  it("选中事务终态后仍显示该终态详情，不自动跳到另一个 blocked 事务", () => {
    const backend = createCompanionBackendRuntime();
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_proj_terminal" },
      target: { kind: "companion", deviceId: "desktop_proj_terminal" },
      type: "affair.create",
      payload: {
        affairId: "affair_projection_canceled",
        title: "已取消的重复任务",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: ["不继续"],
      },
    }));
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "companion", deviceId: "desktop_proj_terminal" },
      target: { kind: "phone", deviceId: "phone_proj_terminal" },
      type: "job.needs_permission",
      payload: {
        jobId: "job_projection_canceled",
        affairId: "affair_projection_canceled",
        executor: "openclaw",
        status: "needs_permission",
        goal: "等待授权",
        allowedPermissions: ["workspace.read"],
        progressSummary: "",
        permissionRequestId: "perm_projection_canceled",
      },
    }));
    // UI 必须仍能显示旧版已落盘的终态冲突详情。
    backend.getState().affairs.set("affair_projection_canceled", {
      ...backend.getState().affairs.get("affair_projection_canceled")!, status: "canceled",
    });
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_proj_terminal" },
      target: { kind: "companion", deviceId: "desktop_proj_terminal" },
      type: "affair.create",
      payload: {
        affairId: "affair_projection_blocked",
        title: "另一个阻塞任务",
        ownerAgent: "zhang-boss",
        status: "blocked",
        context: [],
        acceptanceCriteria: ["处理阻塞"],
        blockedReason: "用户拒绝权限请求",
        resumeCondition: "等待用户决定",
      },
    }));

    const tasks = projectTaskWorkspaceFromSnapshot(backend.getSnapshot(), "affair_projection_canceled");

    assert.equal(tasks.affairs.some((item) => item.groupLabel === "已结束"), true);
    assert.equal(tasks.selectedDetail?.affairId, "affair_projection_canceled");
    assert.equal(tasks.selectedDetail?.status, "canceled");
    assert.equal(tasks.selectedDetail?.currentJob?.status, "needs_permission");
  });

  it("权限页从真实 pending cards 投影，并且诊断报告不含 secret/token", () => {
    const backend = createCompanionBackendRuntime();
    const gate = backend.getPermissionGate();
    backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_proj_001" },
      target: { kind: "companion", deviceId: "desktop_proj_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_projection_002",
        title: "真实权限事务",
        ownerAgent: "zhang-boss",
        status: "delegated",
        context: [],
        acceptanceCriteria: [],
        currentJobId: "job_projection_002",
      },
    }));
    const enqueued = gate.enqueue({
      permissionRequestId: "perm_projection_001",
      jobId: "job_projection_002",
      affairId: "affair_projection_002",
      requester: "zhang-boss",
      requestedPermissions: ["secrets.read"],
      reason: "真实权限请求",
      risk: "high",
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
    assert.equal(panel.pendingCards[0]?.affairTitle, "真实权限事务");
    assert.equal(panel.currentJobId, "job_projection_002");
    assert.equal(report.services.some((item) => item.probeId === "openclaw.gateway"), true);
    assert.equal(reportText.includes("secret"), false);
    assert.equal(reportText.includes("token"), false);
  });
});
