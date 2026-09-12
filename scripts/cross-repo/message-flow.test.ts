/** 真双端模块 + WS；realtime 交付端口使用返回明确结果的替身。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { startCrossRepoHarness, waitUntil } from "./harness.js";

test("单一桌面消息保持未归属，切换 active affair 不串单，用户确认后单向绑定", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  for (const id of ["affair_a", "affair_b"]) h.phone.store.upsertAffair({ affairId: id, title: id, status: "clarifying" });
  h.phone.store.setActiveAffair("affair_a");
  assert.equal((await h.backend.applyBridgeAction({ type: "chat.sendMessage", text: "  请讨论这段材料  " })).ok, true);
  await waitUntil(() => h.phone.store.getMessageInbox().list().length === 1);
  h.phone.store.setActiveAffair("affair_b");
  const item = h.phone.fetchPendingContext({}).items[0];
  assert.equal(item.affairId, null);
  assert.equal(h.phone.fetchPendingContext({ affair_id: "affair_b" }).items.length, 0);
  assert.equal(h.phone.bindMessage({ message_id: item.messageId, affair_id: "affair_a" }).status, "rejected");
  assert.equal(h.phone.bindMessage({ message_id: item.messageId, affair_id: "affair_a", user_confirmation_summary: "用户确认用于 A" }).status, "ok");
  assert.equal(h.phone.fetchPendingContext({ affair_id: "affair_a" }).items[0].text, "  请讨论这段材料  ");
  assert.throws(() => h.phone.bindMessage({ message_id: item.messageId, affair_id: "affair_b", user_confirmation_summary: "换成 B" }), /already_bound/);
});

test("FC 输出未送达不能消费；完整原文交给通话后真实回执使桌面出队", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  const text = "长材料".repeat(1000) + "\n末尾证据";
  await h.backend.applyBridgeAction({ type: "chat.sendMessage", text });
  await waitUntil(() => h.phone.store.getMessageInbox().list().length === 1);
  let sent = false;
  const outputs: { items: { text: string; messageId: string }[] }[] = [];
  const handler = h.createToolHandler({ sendFunctionCallOutput: (_: string, raw: string) => { outputs.push(JSON.parse(raw)); return sent; } });
  const call = (id: string) => handler.handleToolCall({ name: "companion.fetch_pending_context", call_id: id, arguments: "{}" });
  call("fc_failed");
  assert.equal(h.phone.fetchPendingContext({}).items.length, 1);
  assert.equal(h.backend.getPendingContext().list().length, 1);
  sent = true;
  call("fc_delivered");
  await waitUntil(() => h.backend.getPendingContext().list().length === 0);
  const id = outputs[1]!.items[0]!.messageId;
  await waitUntil(() => !!h.phone.store.getMessageInbox().get(id).consumption.receiptConfirmedAt);
  assert.equal(outputs[1]!.items[0]!.text, text);
  assert.equal(h.phone.fetchPendingContext({}).items.length, 0);
  assert.equal(h.phone.fetchPendingContext({ message_id: id }).items[0].text, text);
});

test("通话交付后 receipt 发送失败，重连只补同 ID 回执，桌面重复帧不重复注入", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close); h.setInCall(true);
  const send = h.phone.protocolClient.sendPhone.bind(h.phone.protocolClient);
  const ids: string[] = [];
  let fail = true;
  h.phone.protocolClient.sendPhone = (...args: unknown[]) => {
    if (args[1] === "chat.read_receipt") {
      ids.push((args[3] as { messageId: string }).messageId);
      if (fail) throw new Error("receipt_transport_failed");
    }
    return send(...args);
  };
  await h.backend.applyBridgeAction({ type: "chat.sendMessage", text: "只交付一次" });
  await waitUntil(() => h.injections.length === 1 && ids.length === 1);
  const message = h.phone.store.getMessageInbox().list()[0];
  assert.equal(message.consumption.state, "delivered");
  assert.equal(h.backend.getPendingContext().list().length, 1);
  fail = false;
  h.phone.protocolClient.close();
  await h.phone.openSession(h.server.wsUrl);
  await waitUntil(() => h.backend.getPendingContext().list().length === 0);
  assert.equal(h.injections.length, 1);
  assert.ok(ids.length >= 2);
  assert.ok(ids.every((id) => id === ids[0]));
  assert.equal(h.backend.getState().chatMessages.length, 1);
});
