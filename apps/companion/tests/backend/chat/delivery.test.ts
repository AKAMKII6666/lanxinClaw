/** 原消息、收件人、回执与镜像提交的故障闭环。 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../../src/backend/runtime.js";
import { dispatchBridgeProtocolAction, flushPendingContext } from "../../../src/protocol-server/bridge-actions.js";
import { createPendingContextQueue } from "../../../src/chat/channel/pending-context.js";
import type { BackendMirrorStore } from "../../../src/state/mirror/backend-mirror.js";

function setup() {
  let saved: ReturnType<BackendMirrorStore["load"]> = { schemaVersion: 1, affairs: [], jobs: [], chatMessages: [], contextAttachments: [], pendingContext: [] };
  let failing = false;
  const mirror: BackendMirrorStore = { load: () => structuredClone(saved), save: (next) => {
    if (failing) throw new Error("disk_full");
    saved = structuredClone(next);
  } };
  const backend = createCompanionBackendRuntime({ mirrorStore: mirror });
  const sent: unknown[] = [];
  const deps = {
    getParty: () => ({ phoneDeviceId: "phone_a", desktopDeviceId: "desktop_a" }),
    isSessionAuthenticated: () => true, hasActiveCall: () => false, getAffair: () => undefined,
    pendingContext: backend.getPendingContext(),
    broadcast: (envelope: Parameters<typeof backend.applyProtocolEnvelope>[0]) => {
      assert.equal(backend.getPendingContext().list().length, 1, "发送前已入持久化队列");
      assert.equal(saved.pendingContext.length, 1);
      assert.equal(backend.applyProtocolEnvelope(envelope).ok, true);
      sent.push(envelope.payload);
    },
  };
  return { backend, mirror, deps, sent, fail: (next: boolean) => { failing = next; } };
}

function receipt(chatMessageId: string, phoneDeviceId = "phone_a") {
  return createEnvelope({ type: "chat.read_receipt", source: { kind: "phone", deviceId: phoneDeviceId },
    target: { kind: "companion", deviceId: "desktop_a" }, payload: { chatMessageId, readAt: new Date().toISOString() } });
}

it("重连保持原 ID 和原文，错误收件人不能消费；确认后重启重放回执仍幂等", () => {
  const t = setup();
  const text = "  完整原文\n尾部  ";
  assert.equal(dispatchBridgeProtocolAction({ type: "chat.sendMessage", text }, t.deps).error, null);
  flushPendingContext(t.deps);
  assert.deepEqual(t.sent[0], t.sent[1]);
  assert.equal(t.backend.getState().chatMessages.length, 1);
  const message = t.backend.getState().chatMessages[0]!;
  assert.equal(message.text, text);
  assert.equal(message.affairId, null);
  assert.equal(t.backend.applyProtocolEnvelope(receipt(message.chatMessageId, "phone_other")).ok, false);
  const proof = receipt(message.chatMessageId);
  assert.equal(t.backend.applyProtocolEnvelope(proof).ok, true);
  assert.equal(t.backend.getPendingContext().list().length, 0);
  const restarted = createCompanionBackendRuntime({ mirrorStore: t.mirror });
  const repeated = restarted.applyProtocolEnvelope(proof);
  assert.ok(repeated.ok && repeated.duplicate);
  assert.equal(restarted.getState().chatReceipts.length, 1);
});

it("消费提交失败不出队、不确认；原请求重试可完成", () => {
  const t = setup();
  dispatchBridgeProtocolAction({ type: "chat.sendMessage", text: "正文" }, t.deps);
  const proof = receipt(t.backend.getState().chatMessages[0]!.chatMessageId);
  t.fail(true);
  const rejected = t.backend.applyProtocolEnvelope(proof);
  assert.ok(!rejected.ok && rejected.retryable);
  assert.equal(t.backend.getPendingContext().list().length, 1);
  assert.equal(t.backend.getState().chatReceipts.length, 0);
  t.fail(false);
  assert.equal(t.backend.applyProtocolEnvelope(proof).ok, true);
  assert.equal(t.backend.getPendingContext().list().length, 0);
});

it("出站持久化失败不能发送；旧队列缺收件身份时不能改投另一设备", () => {
  const t = setup();
  t.fail(true);
  assert.throws(() => dispatchBridgeProtocolAction({ type: "chat.sendMessage", text: "正文" }, t.deps), /disk_full/);
  assert.equal(t.sent.length, 0);
  assert.equal(t.backend.getPendingContext().list().length, 0);
  const pending = createPendingContextQueue();
  pending.enqueue({ text: "旧版材料", contentKind: "note", target: "active_call", affairId: null });
  flushPendingContext({ ...t.deps, pendingContext: pending });
  assert.equal(t.sent.length, 0);
  assert.equal(pending.list().length, 1);
});
