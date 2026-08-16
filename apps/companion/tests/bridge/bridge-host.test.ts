/**
 * Bridge host 与 IPC 注册契约测试。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRIDGE_CHANNELS } from "../../src/bridge/contract.js";
import {
  CompanionBridgeHost,
  createDefaultControlPanelSnapshot,
} from "../../src/bridge/host.js";
import { registerBridgeIpc } from "../../src/bridge/register-ipc.js";
import { validateControlPanelSnapshot } from "@lanxin-claw/protocol";

describe("companion bridge host", () => {
  it("默认 snapshot 可通过协议校验且不含危险 action 面", () => {
    const snap = createDefaultControlPanelSnapshot();
    assert.equal(validateControlPanelSnapshot(snap).ok, true);
    const host = new CompanionBridgeHost(snap);
    assert.equal(host.getSnapshot().credential.provider, "openclaw-api");
    assert.equal(host.getSnapshot().currentAffair, null);
  });

  it("接受白名单操作并拒绝未知副作用请求", () => {
    const host = new CompanionBridgeHost();
    const ok = host.submitAction({ type: "credential.requestSync" });
    assert.equal(ok.ok, true);
    assert.equal(
      host.submitAction({
        type: "permission.decide",
        permissionRequestId: "perm_req_001",
        decision: "allow_once",
      }).ok,
      true,
    );
    assert.equal(
      host.submitAction({
        type: "device.revokePairing",
        phoneDeviceId: "phone_1",
        desktopDeviceId: "desk_1",
      }).ok,
      true,
    );
    assert.equal(host.submitAction({ type: "affair.pause", affairId: "affair_1" }).ok, true);
    assert.equal(
      host.submitAction({ type: "pairing.approve", pairingId: "pair_1" }).ok,
      true,
    );
    assert.equal(host.submitAction({ type: "diagnostics.openLogs" }).ok, true);
    assert.equal(host.submitAction({ type: "companion.restart" }).ok, true);
    assert.equal(host.submitAction({ type: "clawCore.restart" }).ok, true);
    assert.equal(
      host.submitAction({
        type: "chat.sendMessage",
        text: "F:/workspace/xxx/src/main.ts",
        affairId: "affair_1",
      }).ok,
      true,
    );
    assert.equal(
      host.submitAction({
        type: "chat.attachContext",
        text: "F:/workspace/xxx/src/main.ts",
        target: "affair",
        contentKind: "path",
        affairId: "affair_1",
      }).ok,
      true,
    );
    assert.equal(
      host.submitAction({
        type: "chat.attachContext",
        text: "missing affair",
        target: "affair",
        contentKind: "note",
      }).ok,
      false,
    );
    const bad = host.submitAction({ type: "command.run", command: "rm -rf /" });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.error.code, "bridge_action_rejected");
    }
    assert.deepEqual(host.listAcceptedActions(), [
      "credential.requestSync",
      "permission.decide",
      "device.revokePairing",
      "affair.pause",
      "pairing.approve",
      "diagnostics.openLogs",
      "companion.restart",
      "clawCore.restart",
      "chat.sendMessage",
      "chat.attachContext",
    ]);
  });

  it("companion.restart 与 clawCore.restart 均为独立白名单意图", () => {
    const host = new CompanionBridgeHost();
    const companion = host.submitAction({ type: "companion.restart" });
    const claw = host.submitAction({ type: "clawCore.restart" });
    assert.equal(companion.ok, true);
    assert.equal(claw.ok, true);
    if (companion.ok && claw.ok) {
      assert.equal(companion.acceptedAction, "companion.restart");
      assert.equal(claw.acceptedAction, "clawCore.restart");
      assert.notEqual(companion.acceptedAction, claw.acceptedAction);
    }
  });

  it("订阅能收到 setSnapshot 推送；非法 snapshot 被拒绝", () => {
    const host = new CompanionBridgeHost();
    const seen: string[] = [];
    host.subscribeSnapshot((snap) => seen.push(snap.snapshotId));
    const next = createDefaultControlPanelSnapshot();
    next.snapshotId = "ui_snap_pushed";
    assert.equal(host.setSnapshot(next).ok, true);
    assert.deepEqual(seen, ["ui_snap_pushed"]);
    assert.equal(host.setSnapshot({ schemaVersion: "9.9" }).ok, false);
  });

  it("reportError 记录客户端错误", () => {
    const host = new CompanionBridgeHost();
    assert.equal(host.reportError({ source: "overview", message: "加载失败" }).ok, true);
    assert.equal(host.listClientErrors().length, 1);
  });

  it("registerBridgeIpc 只挂白名单通道并可推送", () => {
    const host = new CompanionBridgeHost();
    const handlers = new Map<string, Function>();
    const sent: unknown[] = [];
    registerBridgeIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      host,
      () => ({
        send(channel, payload) {
          sent.push([channel, payload]);
        },
      }),
    );
    assert.equal(handlers.has(BRIDGE_CHANNELS.getSnapshot), true);
    assert.equal(handlers.has(BRIDGE_CHANNELS.submitAction), true);
    assert.equal(handlers.has(BRIDGE_CHANNELS.reportError), true);
    assert.equal(handlers.has(BRIDGE_CHANNELS.listPendingPermissions), true);
    const snap = handlers.get(BRIDGE_CHANNELS.getSnapshot)?.({});
    assert.equal(validateControlPanelSnapshot(snap).ok, true);
    const pending = handlers.get(BRIDGE_CHANNELS.listPendingPermissions)?.({});
    assert.equal(Array.isArray(pending), true);
    assert.equal((pending as unknown[]).length, 1);
    const next = createDefaultControlPanelSnapshot();
    next.snapshotId = "ui_snap_ipc";
    host.setSnapshot(next);
    assert.equal(sent.length, 1);
    assert.equal((sent[0] as unknown[])[0], BRIDGE_CHANNELS.snapshotUpdated);
  });

  it("permission.decide 由 host gate 裁决；isGranted 不依赖 renderer 内存", () => {
    const host = new CompanionBridgeHost();
    assert.equal(host.listPendingPermissionCards().length, 1);
    assert.equal(host.isPermissionGranted("job_fix_code_001", "workspace.write"), false);

    const decided = host.submitAction({
      type: "permission.decide",
      permissionRequestId: "perm_req_001",
      decision: "allow_once",
    });
    assert.equal(decided.ok, true);
    if (decided.ok) {
      assert.equal(decided.acceptedAction, "permission.decide");
      assert.ok(decided.info);
      assert.deepEqual(decided.pendingPermissionCards, []);
    }
    assert.equal(host.listPendingPermissionCards().length, 0);
    assert.equal(host.isPermissionGranted("job_fix_code_001", "workspace.write"), true);
    assert.equal(host.isPermissionGranted("job_fix_code_001", "workspace.write"), false);

    const missing = host.submitAction({
      type: "permission.decide",
      permissionRequestId: "perm_req_missing",
      decision: "deny",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.code, "permission_not_found");
    }
  });
});
