/**
 * Mock companion 构建的 UI snapshot / queue / diagnostic 须通过 protocol validators。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateControlPanelSnapshot,
  validateDiagnosticReport,
  validatePermissionQueue,
} from "@lanxin-claw/protocol";
import { loadMockCompanionConfig } from "../../src/config.js";
import { createMemoryStore } from "../../src/store/memory-store.js";
import {
  buildControlPanelSnapshot,
  buildDiagnosticReport,
  buildPermissionQueue,
} from "../../src/ui/build-ui-views.js";

describe("mock companion UI 视图 contract", () => {
  it("空 store snapshot / queue / diagnostic 通过校验", () => {
    const config = loadMockCompanionConfig({ MOCK_COMPANION_DEVICE_ID: "desktop_ui_001" });
    const store = createMemoryStore(Date.now());

    const snap = validateControlPanelSnapshot(buildControlPanelSnapshot(store, config));
    assert.equal(snap.ok, true, snap.ok ? "" : snap.error.message);

    const queue = validatePermissionQueue(buildPermissionQueue(store));
    assert.equal(queue.ok, true, queue.ok ? "" : queue.error.message);

    const report = validateDiagnosticReport(buildDiagnosticReport(store, config));
    assert.equal(report.ok, true, report.ok ? "" : report.error.message);
  });

  it("配对 + session + affair 后 snapshot 反映 connected / supervising", () => {
    const config = loadMockCompanionConfig({ MOCK_COMPANION_DEVICE_ID: "desktop_ui_002" });
    const store = createMemoryStore(Date.now());
    store.paired = {
      pairingId: "pair_ui",
      phoneDeviceId: "phone_ui",
      phoneDisplayName: "UI Phone",
      authProof: "mock-paired:pair_ui",
      pairedAt: "2026-07-23T00:00:00.000Z",
    };
    store.session = {
      sessionId: "sess_ui",
      phoneDeviceId: "phone_ui",
      openedAt: "2026-07-23T00:01:00.000Z",
    };
    store.affairs.set("affair_ui", {
      affairId: "affair_ui",
      title: "UI 事务",
      ownerAgent: "zhang-boss",
      status: "running",
      context: [],
      acceptanceCriteria: ["ok"],
      blockedReason: null,
      resumeCondition: null,
      currentJobId: "job_ui",
    });
    store.jobs.set("job_ui", {
      jobId: "job_ui",
      affairId: "affair_ui",
      executor: "openclaw",
      status: "running",
      goal: "ui",
      workspaceHint: null,
      allowedPermissions: ["workspace.read"],
      progressSummary: "进行中",
      blockedReason: null,
      resumeCondition: null,
      permissionRequestId: null,
    });

    const snapObj = buildControlPanelSnapshot(store, config);
    const snap = validateControlPanelSnapshot(snapObj);
    assert.equal(snap.ok, true, snap.ok ? "" : snap.error.message);
    assert.equal(snapObj.device.status, "connected");
    assert.equal(snapObj.zhangBoss.status, "supervising");
    assert.equal(snapObj.currentAffair?.status, "running");
    assert.equal(
      JSON.stringify(snapObj).includes("sk-"),
      false,
      "snapshot 不得含疑似 key 前缀",
    );
  });

  it("pending 权限项进入 queue 且可校验", () => {
    const store = createMemoryStore(Date.now());
    store.permissionItems.push({
      permissionRequestId: "perm_ui_1",
      queueStatus: "pending",
      requester: "zhang-boss",
      affairId: "affair_ui",
      jobId: "job_ui",
      requestedPermissions: ["workspace.write"],
      reason: "写文件",
      risk: "medium",
      proposedScope: { workspaceRoot: null, commands: [], networkHosts: [] },
      availableDecisions: ["allow_once", "allow_for_job", "deny", "require_more_context"],
      denyConsequence: "停在 needs_permission",
      requestedAt: "2026-07-23T00:00:00.000Z",
      expiresAt: null,
    });
    const queueObj = buildPermissionQueue(store);
    const queue = validatePermissionQueue(queueObj);
    assert.equal(queue.ok, true, queue.ok ? "" : queue.error.message);
    assert.equal(queueObj.pendingCount, 1);
  });
});
