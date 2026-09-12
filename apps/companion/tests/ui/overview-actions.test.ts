/**
 * 总览五卡操作规划单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planCredentialSync,
  planOpenChat,
  planOpenDiagnostics,
  planRequestPairing,
  planViewAffairDetail,
  planViewTasks,
  snapshotHasPendingPairing,
} from "../../src/ui/pages/overview/overview-actions.js";
import type { ControlPanelSnapshotView } from "../../src/bridge/contract.js";

function baseSnapshot(
  overrides: Partial<ControlPanelSnapshotView["device"]> = {},
): ControlPanelSnapshotView {
  return {
    clawCore: { status: "running", version: null, adapterReady: true, message: null },
    credential: {
      status: "synced",
      provider: "openclaw-gateway",
      lastSyncedAt: null,
      expiresAt: null,
      message: null,
    },
    device: {
      status: "not_found",
      phoneDeviceId: null,
      phoneDisplayName: null,
      pairingId: null,
      sessionId: null,
      fingerprintHint: null,
      lastSeenAt: null,
      message: null,
      ...overrides,
    },
    zhangBoss: { status: "offline", summary: null, activeAffairId: null, activeCallId: null },
    currentAffair: null,
  };
}

describe("overview action plans", () => {
  it("诊断 / 聊天 / 任务映射到对应导航页", () => {
    assert.equal(planOpenDiagnostics().navigateTo, "diagnostics");
    assert.equal(planOpenDiagnostics().bridgeAction.type, "clawCore.openDiagnostics");
    assert.equal(planOpenChat().navigateTo, "zhang-boss");
    assert.equal(planViewTasks().navigateTo, "tasks");
    assert.equal(planViewAffairDetail("af-1").navigateTo, "tasks");
    assert.deepEqual(planViewAffairDetail("af-1").bridgeAction, {
      type: "affair.viewDetail",
      affairId: "af-1",
    });
  });

  it("凭据同步按状态给出明确反馈且不切页", () => {
    const synced = planCredentialSync("synced");
    assert.equal(synced.navigateTo, null);
    assert.match(synced.feedback ?? "", /无需再次同步/);
    const missing = planCredentialSync("missing");
    assert.match(missing.feedback ?? "", /配置门/);
  });

  it("重新配对：有 pending 则打开 Dialog，否则提示等待电话", () => {
    const open = planRequestPairing(true);
    assert.equal(open.openPairing, true);
    assert.equal(open.feedback, null);
    const wait = planRequestPairing(false);
    assert.equal(wait.openPairing, false);
    assert.match(wait.feedback ?? "", /尚未发现/);
  });

  it("snapshotHasPendingPairing 与壳侧条件一致", () => {
    assert.equal(snapshotHasPendingPairing(baseSnapshot()), false);
    assert.equal(
      snapshotHasPendingPairing(
        baseSnapshot({ pairingId: "p1", phoneDeviceId: "phone-1", sessionId: null }),
      ),
      true,
    );
    assert.equal(
      snapshotHasPendingPairing(
        baseSnapshot({ pairingId: "p1", phoneDeviceId: "phone-1", sessionId: "s1" }),
      ),
      false,
    );
  });
});
