/**
 * 审计、精确文本通道、重连策略单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryAuditStore } from "../../src/audit/memory-store.js";
import { planContextDelivery } from "../../src/chat/channel/delivery.js";
import { createPendingContextQueue } from "../../src/chat/channel/pending-context.js";
import { createDemoTaskWorkspace, getDemoAffairDetail } from "../../src/ui/pages/tasks/tasks-demo.js";
import {
  DEFAULT_RECONNECT_POLICY,
  disconnectHintCopy,
  nextReconnectDelayMs,
  trayConnectionToolTip,
} from "../../src/shell/session/reconnect-policy.js";
import { readOpenAtLogin, setOpenAtLogin } from "../../src/shell/session/autostart.js";

describe("audit store", () => {
  it("追加权限审计并可转视图；拒绝密钥摘要", () => {
    const store = createMemoryAuditStore();
    const ok = store.append({
      kind: "permission",
      summary: "允许 job_1 的 workspace.write（once）",
      jobId: "job_1",
      permissionRequestId: "perm_1",
      outcome: "allow_once",
      risk: "medium",
    });
    assert.equal(ok.ok, true);
    const bad = store.append({
      kind: "permission",
      summary: "leak apiKey somehow",
    });
    assert.equal(bad.ok, false);
    const views = store.toViews();
    assert.equal(views.length, 1);
    assert.equal(views[0]?.kindLabel, "权限");
  });
});

describe("context delivery + pending", () => {
  it("realtime 优先；否则 FC fallback；可入 pending", () => {
    const realtime = planContextDelivery(
      { realtimeInjectAvailable: true, companionFcAvailable: true },
      true,
    );
    assert.equal(realtime?.channel, "realtime_inject");

    const fallback = planContextDelivery(
      { realtimeInjectAvailable: false, companionFcAvailable: true },
      true,
    );
    assert.equal(fallback?.channel, "companion_fc");

    const queued = planContextDelivery(
      { realtimeInjectAvailable: false, companionFcAvailable: true },
      false,
    );
    assert.equal(queued?.enqueuePending, true);

    const none = planContextDelivery(
      { realtimeInjectAvailable: false, companionFcAvailable: false },
      true,
    );
    assert.equal(none, null);
  });

  it("pending 队列要求 affair 目标带 affairId", () => {
    const q = createPendingContextQueue();
    const miss = q.enqueue({
      text: "note",
      contentKind: "note",
      target: "affair",
      affairId: null,
    });
    assert.equal(miss.ok, false);
    const ok = q.enqueue({
      text: "F:/a.ts",
      contentKind: "path",
      target: "affair",
      affairId: "affair_1",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(q.take(ok.item.pendingId)?.text, "F:/a.ts");
    }
  });
});

describe("reconnect + autostart", () => {
  it("退避与断线文案", () => {
    assert.equal(nextReconnectDelayMs(DEFAULT_RECONNECT_POLICY, 0), 1_000);
    assert.equal(nextReconnectDelayMs(DEFAULT_RECONNECT_POLICY, 1), 2_000);
    assert.equal(nextReconnectDelayMs(DEFAULT_RECONNECT_POLICY, 99), null);
    assert.match(disconnectHintCopy("gave_up"), /自动重连已停止/);
    assert.equal(trayConnectionToolTip(false, true), "澜星 Claw · 重连中");
  });

  it("开机启动读写经 port", () => {
    let flag = false;
    const port = {
      isOpenAtLogin: () => flag,
      setOpenAtLogin: (v: boolean) => {
        flag = v;
      },
    };
    assert.equal(readOpenAtLogin(port), false);
    assert.equal(setOpenAtLogin(port, true), true);
  });
});

describe("task detail demo depth", () => {
  it("详情含脉络、blocker、验收结果字段", () => {
    const ws = createDemoTaskWorkspace();
    assert.ok(ws.affairs.length >= 3);
    const blocked = getDemoAffairDetail("affair_python_env_001");
    assert.ok(blocked);
    assert.ok((blocked?.timeline.length ?? 0) >= 1);
    assert.ok(blocked?.blockerSummary);
    assert.ok(blocked?.resumeCondition);
    const waiting = getDemoAffairDetail("affair_docs_review_001");
    assert.equal(waiting?.status, "waiting_acceptance");
    assert.ok(waiting?.acceptanceResult);
    assert.notEqual(waiting?.status, "closed");
  });
});
