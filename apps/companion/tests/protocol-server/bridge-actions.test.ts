/**
 * bridge action 出站协议测试。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffairPayload, ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { BridgeActionDelivery } from "../../src/bridge/contract.js";
import { createPendingContextQueue } from "../../src/chat/channel/pending-context.js";
import { dispatchBridgeProtocolAction, flushPendingContext } from "../../src/protocol-server/bridge-actions.js";

function baseAffair(patch: Partial<AffairPayload> = {}): AffairPayload {
  return {
    affairId: "affair_bridge_001",
    title: "桥接事务",
    ownerAgent: "zhang-boss",
    status: "waiting_acceptance",
    context: ["用户原始上下文"],
    acceptanceCriteria: ["用户验收标准"],
    currentJobId: "job_bridge_001",
    ...patch,
  };
}

function createDeps(affair: AffairPayload, authenticated = true) {
  let sessionAuthenticated = authenticated;
  const affairs = new Map<string, AffairPayload>([[affair.affairId, affair]]);
  const sent: ProtocolEnvelope[] = [];
  const deliveries: BridgeActionDelivery[] = [];
  return {
    sent,
    deliveries,
    setAuthenticated(next: boolean) {
      sessionAuthenticated = next;
    },
    deps: {
      getParty: () => ({ desktopDeviceId: "desktop_bridge", phoneDeviceId: "phone_bridge" }),
      isSessionAuthenticated: () => sessionAuthenticated,
      hasActiveCall: () => false,
      getAffair: (affairId: string) => affairs.get(affairId),
      broadcast: (envelope: ProtocolEnvelope) => {
        sent.push(envelope);
        if (envelope.type.startsWith("affair.")) {
          affairs.set((envelope.payload as AffairPayload).affairId, envelope.payload as AffairPayload);
        }
      },
      pendingContext: createPendingContextQueue(),
      recordActionDelivery: (delivery: BridgeActionDelivery) => {
        deliveries.push(delivery);
      },
    },
  };
}

describe("dispatchBridgeProtocolAction", () => {
  it("affair.accept 发送 affair.close(status=closed)", () => {
    const { deps, sent } = createDeps(baseAffair());
    const result = dispatchBridgeProtocolAction(
      { type: "affair.accept", affairId: "affair_bridge_001" },
      deps,
    );

    assert.equal(result.error, null);
    assert.equal(result.delivery?.status, "sent_to_phone");
    assert.equal(sent[0]?.type, "affair.close");
    assert.equal((sent[0]?.payload as AffairPayload).status, "closed");
  });

  it("affair.requestRevision 先 resume，再附加继续处理 note", () => {
    const { deps, sent } = createDeps(baseAffair());
    const result = dispatchBridgeProtocolAction(
      { type: "affair.requestRevision", affairId: "affair_bridge_001" },
      deps,
    );

    assert.equal(result.error, null);
    assert.equal(result.delivery?.status, "sent_to_phone");
    assert.equal(sent[0]?.type, "affair.resume");
    assert.equal((sent[0]?.payload as AffairPayload).status, "running");
    assert.equal(sent[1]?.type, "chat.context_attach");
    assert.match(JSON.stringify(sent[1]?.payload), /继续推进事务/);
  });

  it("affair.requestAcceptance 附加张老板回报 note", () => {
    const { deps, sent } = createDeps(baseAffair({ status: "running" }));
    const result = dispatchBridgeProtocolAction(
      { type: "affair.requestAcceptance", affairId: "affair_bridge_001" },
      deps,
    );

    assert.equal(result.error, null);
    assert.equal(result.delivery?.status, "sent_to_phone");
    assert.equal(sent[0]?.type, "chat.context_attach");
    assert.match(JSON.stringify(sent[0]?.payload), /回报当前事务状态/);
  });

  it("affair.requestAcceptance 离线时进入 pending context 并返回 queued delivery", () => {
    const { deps, sent } = createDeps(baseAffair({ status: "running" }), false);
    const result = dispatchBridgeProtocolAction(
      { type: "affair.requestAcceptance", affairId: "affair_bridge_001" },
      deps,
    );

    assert.equal(result.error, null);
    assert.equal(result.delivery?.status, "queued_until_session");
    assert.equal(result.delivery?.reasonCode, "session_not_authenticated");
    assert.equal(sent.length, 0);
    assert.equal(deps.pendingContext.list().length, 1);
  });

  it("flushPendingContext 使用同一 receipt id 记录 queued -> sent_to_phone", () => {
    const { deps, sent, deliveries, setAuthenticated } = createDeps(baseAffair({ status: "running" }), false);
    const result = dispatchBridgeProtocolAction(
      { type: "affair.requestAcceptance", affairId: "affair_bridge_001" },
      deps,
    );
    const receiptId = result.delivery?.actionReceiptId;

    assert.ok(receiptId);
    assert.equal(result.delivery?.status, "queued_until_session");
    assert.equal(deps.pendingContext.list()[0]?.actionReceiptId, receiptId);

    setAuthenticated(true);
    flushPendingContext(deps);

    assert.equal(sent[0]?.type, "chat.context_attach");
    assert.equal(deliveries[0]?.actionReceiptId, receiptId);
    assert.equal(deliveries[0]?.status, "sent_to_phone");
    assert.equal(deliveries[0]?.jobId, "job_bridge_001");
    assert.ok(deliveries[0]?.deliveredAt);
    assert.equal(deps.pendingContext.list().length, 0);
  });

  it("chat.attachContext(active_call) 有 session 时即使 hasActiveCall=false 也直发", () => {
    const { deps, sent } = createDeps(baseAffair({ status: "running" }), true);
    const result = dispatchBridgeProtocolAction(
      {
        type: "chat.attachContext",
        text: "F:/workspace/demo.ts",
        target: "active_call",
        contentKind: "path",
      },
      deps,
    );

    assert.equal(result.error, null);
    assert.equal(result.delivery?.status, "sent_to_phone");
    assert.equal(sent[0]?.type, "chat.context_attach");
    assert.equal((sent[0]?.payload as { target?: string }).target, "active_call");
    assert.equal(deps.pendingContext.list().length, 0);
  });
});
