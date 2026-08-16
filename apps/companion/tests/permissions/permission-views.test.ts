/**
 * 权限视图映射与演示状态单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoPermissionPanel } from "../../src/permissions/demo-panel-state.js";
import {
  pairedDeviceViewLooksSafe,
  toPairedDeviceView,
} from "../../src/permissions/to-paired-device-view.js";
import type { DeviceIdentityRecord } from "../../src/credentials/device-identity.js";

describe("permission panel views", () => {
  it("toPairedDeviceView 剥离 pairingSecret 且可 revoke", () => {
    const record: DeviceIdentityRecord = {
      pairingId: "pair_test",
      phoneDeviceId: "phone_1",
      phoneDisplayName: "测试电话",
      desktopDeviceId: "desk_1",
      desktopDisplayName: "测试桌面",
      pairingSecret: "must-not-leak",
      lifecycle: "active",
      pairedAt: "2026-07-23T00:00:00.000Z",
      revokedAt: null,
      revokeReason: null,
    };
    const view = toPairedDeviceView(record, "已连接", "AA:BB:…");
    assert.equal(view.canRevoke, true);
    assert.equal(view.fingerprintHint, "AA:BB:…");
    assert.equal(pairedDeviceViewLooksSafe(view), true);
    assert.equal(JSON.stringify(view).includes("must-not-leak"), false);
  });

  it("演示面板含设备、job 权限与待确认卡片", () => {
    const panel = createDemoPermissionPanel();
    assert.ok(panel.pairedDevices.length >= 1);
    assert.ok(panel.jobPermissions.length >= 1);
    assert.ok(panel.pendingCards.length >= 1);
    const card = panel.pendingCards[0];
    assert.ok(card.availableDecisions.includes("allow_once"));
    assert.ok(card.availableDecisions.includes("deny"));
    assert.equal(JSON.stringify(panel).includes("pairingSecret"), false);
  });
});
