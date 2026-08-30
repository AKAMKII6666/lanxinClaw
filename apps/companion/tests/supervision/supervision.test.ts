/**
 * 后台监督 loop 与验收策略单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptanceCopy,
  affairStatusAfterJobTerminal,
  affairStatusAfterUserAcceptance,
  detectIllegalAutoClose,
} from "../../src/supervision/policy/acceptance.js";
import {
  createSupervisionNotifyMemory,
  rememberBlockedNotify,
  runSupervisionTick,
} from "../../src/supervision/tick.js";
import type { SupervisionSnapshot } from "../../src/supervision/types.js";
import { applySupervisionActions } from "../../src/supervision/apply-actions.js";
import type { AffairPayload, ProtocolEnvelope } from "@lanxin-claw/protocol";

function baseSnapshot(
  overrides: Partial<SupervisionSnapshot>,
): SupervisionSnapshot {
  return {
    affairId: "affair_1",
    affairTitle: "示例事务",
    affairStatus: "running",
    jobId: "job_1",
    jobStatus: "running",
    progressSummary: "推进中",
    attemptedSteps: ["步骤 A"],
    blockedReason: null,
    resumeCondition: null,
    observedAt: "2026-07-23T12:00:00.000Z",
    ...overrides,
  };
}

describe("supervision tick", () => {
  it("job completed 产出 mark_waiting_acceptance 而非 closed", () => {
    const actions = runSupervisionTick(
      baseSnapshot({ jobStatus: "completed" }),
      createSupervisionNotifyMemory(),
    );
    assert.equal(actions[0]?.kind, "mark_waiting_acceptance");
    assert.equal(
      actions.some((a) => a.kind === "mark_waiting_acceptance"),
      true,
    );
  });

  it("exploration completed 只继续观察，不进入验收", () => {
    const actions = runSupervisionTick(
      baseSnapshot({ jobStatus: "completed", jobPurpose: "exploration" }),
      createSupervisionNotifyMemory(),
    );
    assert.equal(actions[0]?.kind, "continue_watch");
    assert.equal(
      actions.some((a) => a.kind === "mark_waiting_acceptance"),
      false,
    );
  });

  it("首次 blocked 通知；同指纹抑制", () => {
    const memory = createSupervisionNotifyMemory();
    const snap = baseSnapshot({
      jobStatus: "blocked",
      blockedReason: "网络不可用",
      resumeCondition: "恢复外网后 resume",
      attemptedSteps: ["pip install"],
    });
    const first = runSupervisionTick(snap, memory);
    assert.ok(first.some((a) => a.kind === "notify_blocked"));
    const notify = first.find((a) => a.kind === "notify_blocked");
    assert.ok(notify && notify.kind === "notify_blocked");
    rememberBlockedNotify(memory, snap.affairId, notify.fingerprint);
    const second = runSupervisionTick(snap, memory);
    assert.equal(
      second.some((a) => a.kind === "notify_blocked"),
      false,
    );
    assert.ok(second.some((a) => a.kind === "mark_blocked"));
  });

  it("终态 stop_watch", () => {
    const actions = runSupervisionTick(
      baseSnapshot({ affairStatus: "closed", jobStatus: "completed" }),
      createSupervisionNotifyMemory(),
    );
    assert.equal(actions[0]?.kind, "stop_watch");
  });
});

describe("acceptance strategy", () => {
  it("completed → waiting_acceptance；用户 accept → closed", () => {
    assert.equal(affairStatusAfterJobTerminal("completed"), "waiting_acceptance");
    assert.equal(affairStatusAfterJobTerminal("failed"), null);
    assert.equal(
      affairStatusAfterUserAcceptance("waiting_acceptance", "accept"),
      "closed",
    );
    assert.equal(
      affairStatusAfterUserAcceptance("waiting_acceptance", "cancel"),
      "canceled",
    );
    assert.equal(affairStatusAfterUserAcceptance("running", "accept"), null);
  });

  it("检测非法 auto-close", () => {
    assert.match(
      detectIllegalAutoClose("closed", "completed") ?? "",
      /不得自动映射/,
    );
    assert.equal(detectIllegalAutoClose("waiting_acceptance", "completed"), null);
  });

  it("验收文案不含凭据字样", () => {
    const text = [
      acceptanceCopy("waiting"),
      acceptanceCopy("accepted"),
      acceptanceCopy("canceled"),
    ].join(" ");
    assert.equal(text.includes("apiKey"), false);
    assert.equal(text.includes("pairingSecret"), false);
  });
});

describe("applySupervisionActions", () => {
  it("mark_waiting_acceptance 广播 affair.update 且不得 closed", () => {
    const affair: AffairPayload = {
      affairId: "affair_apply_001",
      title: "落地",
      ownerAgent: "zhang-boss",
      status: "running",
      context: [],
      acceptanceCriteria: ["ok"],
      blockedReason: null,
      resumeCondition: null,
      currentJobId: "job_apply_001",
    };
    const affairs = new Map([[affair.affairId, affair]]);
    const broadcasts: ProtocolEnvelope[] = [];
    applySupervisionActions(
      [
        {
          kind: "mark_waiting_acceptance",
          affairId: affair.affairId,
          jobId: "job_apply_001",
          reason: "worker completed",
        },
      ],
      {
        getAffair: (id) => affairs.get(id),
        broadcast: (envelope) => {
          broadcasts.push(envelope);
          if (envelope.type === "affair.update") {
            affairs.set(affair.affairId, envelope.payload as AffairPayload);
          }
        },
        party: { desktopDeviceId: "d1", phoneDeviceId: "p1" },
      },
    );
    assert.equal(broadcasts[0]?.type, "affair.update");
    assert.equal((broadcasts[0]?.payload as AffairPayload).status, "waiting_acceptance");
    assert.notEqual((broadcasts[0]?.payload as AffairPayload).status, "closed");
  });
});
