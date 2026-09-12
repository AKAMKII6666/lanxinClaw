/** 真实跨仓请求/事件闭环，避免 phone 和 desktop 各自替身互相证明。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PROTOCOL_VERSION, validateProtocolResultAck } from "@lanxin-claw/protocol";
import { startCrossRepoHarness, waitUntil } from "./harness.js";

test("真实 phone 创建任务、接收关联 ack/permission，并收敛即时完成结果", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  h.runtime.client.createRun = async () => ({ runId: "run_cross_fast", status: "completed", summary: "检查完成，返回三个结果：alpha、beta、gamma" });
  const created = await h.phone.createJobFromTool({
    title: "只读检查", goal: "检查工作目录", acceptance_criteria: ["返回检查结果"], allowed_permissions: ["workspace.read"],
  });
  assert.equal(created.status, "needs_permission");
  const request = h.backend.listPendingPermissionCards()[0]; assert.ok(request);
  assert.equal(h.backend.getPermissionGate().decide(request.permissionRequestId, "allow_for_job").ok, true);
  await h.delegator.handlePermissionGranted(request.permissionRequestId);
  await waitUntil(() => h.phone.store.getAffair(created.affairId)?.status === "waiting_acceptance");
  assert.equal(h.backend.getState().jobs.get(created.jobId)?.status, "completed");
  assert.equal(h.backend.getState().affairs.get(created.affairId)?.status, "waiting_acceptance");
  assert.equal(h.phone.store.getAffair(created.affairId).jobs[created.jobId].status, "completed");
  assert.equal(h.phone.protocolClient.pendingWaiterCount(), 0);
});

test("真实 WS 的并发同类成功与失败 ack 均绑定正确请求", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  const good = h.phone.protocolClient.requestPhone(h.ids, "chat.message", {
    chatMessageId: "chat_cross", text: "普通消息", authorKind: "user", sentAt: new Date().toISOString(),
  }, { messageId: "request_good" });
  const bad = h.phone.protocolClient.requestPhone(h.ids, "chat.message", {
    chatMessageId: "chat_bad", text: "", authorKind: "user", sentAt: new Date().toISOString(),
  }, { messageId: "request_bad" });
  const [a, b] = await Promise.all([good.result, bad.result]);
  assert.equal(a.ok, true); assert.equal(a.correlationId, "request_good");
  assert.equal(b.ok, false); assert.equal(b.correlationId, "request_bad");
  assert.equal(validateProtocolResultAck(a).ok, true); assert.equal(validateProtocolResultAck(b).ok, true);
  assert.equal(h.backend.getState().chatMessages.length, 1);
});

test("旧版本业务请求在真实服务端拒绝，并返回可关联的升级原因", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  const result = h.phone.protocolClient.waitForResultAck("chat.message", 1000, "old_version");
  h.phone.protocolClient.send({ protocolVersion: "0.1", messageId: "old_version", sentAt: new Date().toISOString(),
    source: { kind: "phone", deviceId: h.ids.phoneDeviceId }, target: { kind: "companion", deviceId: h.ids.desktopDeviceId },
    type: "chat.message", payload: { chatMessageId: "old", text: "旧版消息", authorKind: "user", sentAt: new Date().toISOString() },
  });
  const ack = await result;
  assert.equal(ack.ok, false); assert.equal(ack.protocolVersion, PROTOCOL_VERSION);
  assert.match(ack.error.message, /0\.2/); assert.equal(h.backend.getState().chatMessages.length, 0);
});
