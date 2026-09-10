/** 真实 WS + 双端 store 下的关闭、竞态与幂等证明。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AffairClosePayload } from "@lanxin-claw/protocol";
import { startCrossRepoHarness, waitUntil } from "./harness.js";

async function create(h: Awaited<ReturnType<typeof startCrossRepoHarness>>) {
  return h.phone.createJobFromTool({ title: "关闭验证", goal: "检查目录", acceptance_criteria: ["返回文件列表"], allowed_permissions: ["workspace.read"] });
}

function closeCommand(created: { affairId: string; jobId: string }): AffairClosePayload {
  return { affairId: created.affairId, expectedCurrentJobId: created.jobId, status: "canceled", closeReason: "用户取消" };
}

test("授权前取消经共同协调器失效权限，提交子 job 与父事务后返回完整回执", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  const created = await create(h);
  const command = closeCommand(created);
  const ack = await h.phone.protocolClient.requestPhone(h.ids, "affair.close", command, { messageId: "cancel_before_grant" }).result;
  assert.equal(ack.ok, true);
  assert.equal(ack.result.affair.status, "canceled");
  assert.equal(ack.result.jobs[0].status, "canceled");
  assert.equal(h.backend.listPendingPermissionCards().length, 0);
  await waitUntil(() => h.phone.store.getAffair(created.affairId).status === "canceled");
  const again = await h.phone.protocolClient.requestPhone(h.ids, "affair.close", command, { messageId: "cancel_before_grant" }).result;
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.result, ack.result);
  const changed = await h.phone.protocolClient.requestPhone(h.ids, "affair.close", { ...command, closeReason: "改写原请求" }, { messageId: "cancel_before_grant" }).result;
  assert.equal(changed.ok, false);
  assert.equal(changed.error.code, "affair_action_id_conflict");
});

test("取消仅被 runtime 接受时父事务保持待确认，同 ID 重试取得停止证据后才关闭", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  h.runtime.client.createRun = async () => ({ runId: "run_cancel", status: "accepted" });
  h.runtime.client.getRun = async () => ({ runId: "run_cancel", status: "accepted" });
  let cancelCount = 0;
  h.runtime.client.cancelRun = async () => { cancelCount++; return { runId: "run_cancel", status: "accepted" }; };
  const created = await create(h);
  const permission = h.backend.listPendingPermissionCards()[0]!;
  h.backend.getPermissionGate().decide(permission.permissionRequestId, "allow_for_job");
  await h.delegator.handlePermissionGranted(permission.permissionRequestId);
  const command = closeCommand(created);
  const first = await h.phone.protocolClient.requestPhone(h.ids, "affair.close", command, { messageId: "cancel_retry" }).result;
  assert.equal(first.ok, false);
  assert.equal(first.error.retryable, true);
  assert.notEqual(h.backend.getState().affairs.get(created.affairId)?.status, "canceled");
  assert.equal(h.backend.getAffairActions().isClosing(created.affairId), true);
  assert.equal(h.backend.getPermissionGate().hasGrant(created.jobId, "workspace.read"), false);
  h.runtime.client.cancelRun = async () => { cancelCount++; return { runId: "run_cancel", status: "cancelled" }; };
  const confirmed = await h.phone.protocolClient.requestPhone(h.ids, "affair.close", command, { messageId: "cancel_retry" }).result;
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.result.affair.status, "canceled");
  assert.equal(cancelCount, 2);
});

test("createRun 在取消之后才返回也被接管，heartbeat 不受事务队列阻塞", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  h.runtime.client.createRun = async () => {
    started(); await new Promise<void>((resolve) => { release = resolve; });
    return { runId: "run_late", status: "accepted" };
  };
  h.runtime.client.getRun = async () => ({ runId: "run_late", status: "accepted" });
  let canceled = 0;
  h.runtime.client.cancelRun = async () => { canceled++; return { runId: "run_late", status: "cancelled" }; };
  const created = await create(h);
  const permission = h.backend.listPendingPermissionCards()[0]!;
  h.backend.getPermissionGate().decide(permission.permissionRequestId, "allow_for_job");
  const granted = h.delegator.handlePermissionGranted(permission.permissionRequestId);
  await entered;
  const closing = h.phone.protocolClient.requestPhone(h.ids, "affair.close", closeCommand(created), { messageId: "cancel_late" }).result;
  await waitUntil(() => h.backend.getAffairActions().isClosing(created.affairId));
  const session = h.phone.store.readSession();
  const heartbeat = await h.phone.protocolClient.requestPhone(h.ids, "session.heartbeat", {
    sessionId: session.sessionId, sentAt: new Date().toISOString(),
  }, { messageId: "heartbeat_during_cancel" }).result;
  assert.equal(heartbeat.ok, true);
  assert.notEqual(h.backend.getState().affairs.get(created.affairId)?.status, "canceled");
  release(); await granted;
  const ack = await closing;
  assert.equal(ack.ok, true);
  assert.equal(canceled, 1);
  assert.equal(h.delegator.activeJobCount(), 0);
});

test("验收必须匹配当前 execution job 及完成证据，旧快照不能关闭", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  h.runtime.client.createRun = async () => ({ runId: "run_accept", status: "completed", evidence: {
    runId: "run_accept", observedAt: new Date().toISOString(),
    wait: { status: "ok", endedAt: new Date().toISOString() }, toolFindings: [],
    finalReply: { text: "检查完成，共 3 个文件：alpha.txt、beta.txt、gamma.txt", source: "wait-result", confidence: "medium" },
  } });
  const created = await create(h);
  const permission = h.backend.listPendingPermissionCards()[0]!;
  h.backend.getPermissionGate().decide(permission.permissionRequestId, "allow_for_job");
  await h.delegator.handlePermissionGranted(permission.permissionRequestId);
  const command = { ...closeCommand(created), status: "closed", acceptanceSummary: "用户确认文件列表符合要求" };
  const stale = await h.phone.protocolClient.requestPhone(h.ids, "affair.close", { ...command, expectedCurrentJobId: "old_job" }).result;
  assert.equal(stale.ok, false); assert.equal(stale.error.code, "affair_current_job_changed");
  const good = await h.phone.protocolClient.requestPhone(h.ids, "affair.close", command).result;
  assert.equal(good.ok, true, JSON.stringify({good, affair: h.backend.getState().affairs.get(created.affairId), job: h.backend.getState().jobs.get(created.jobId)})); assert.equal(good.result.affair.status, "closed");
  assert.equal(good.result.jobs[0].status, "completed");
});

test("真实 phone 取消工具等待远端提交，返回携证确认而非发送成功", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  const created = await create(h);
  const result = await h.phone.cancelAffair({ affair_id: created.affairId, reason: "用户明确取消" });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(result.confirmed, true);
  assert.equal(result.confirmation.result.affair.status, "canceled");
  assert.equal(h.phone.store.getAffair(created.affairId).jobs[created.jobId].status, "canceled");
  assert.equal(h.phone.store.listActionRecords()[0].phase, "confirmed");
});

test("关闭提交期间断线时 phone 不声称完成，重连沿用原请求恢复确认", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  h.runtime.client.createRun = async () => ({ runId: "run_disconnect", status: "accepted" });
  h.runtime.client.getRun = async () => ({ runId: "run_disconnect", status: "accepted" });
  let cancelCount = 0;
  h.runtime.client.cancelRun = async () => {
    cancelCount++; h.phone.protocolClient.close();
    return { runId: "run_disconnect", status: "cancelled" };
  };
  const created = await create(h);
  const permission = h.backend.listPendingPermissionCards()[0]!;
  h.backend.getPermissionGate().decide(permission.permissionRequestId, "allow_for_job");
  await h.delegator.handlePermissionGranted(permission.permissionRequestId);
  const result = await h.phone.cancelAffair({ affair_id: created.affairId });
  assert.equal(result.status, "pending_unconfirmed"); assert.equal(result.confirmed, false);
  await waitUntil(() => h.backend.getState().affairs.get(created.affairId)?.status === "canceled");
  await h.phone.openSession(h.server.wsUrl);
  await waitUntil(() => h.phone.store.listActionRecords()[0]?.phase === "confirmed");
  assert.equal(h.phone.store.listActionRecords()[0].requestId, result.requestId);
  assert.equal(h.phone.store.getAffair(created.affairId).status, "canceled");
  assert.equal(cancelCount, 1);
});

test("真实桌面 bridge 验收带所见 job，phone 可用完整关闭结果补齐离线期间的执行事件", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  h.runtime.client.createRun = async () => ({ runId: "run_ui_accept", status: "completed", evidence: {
    runId: "run_ui_accept", observedAt: new Date().toISOString(), toolFindings: [],
    wait: { status: "ok", endedAt: new Date().toISOString() },
    finalReply: { text: "检查完成，共 3 个文件：alpha.txt、beta.txt、gamma.txt", source: "wait-result", confidence: "medium" },
  } });
  const created = await create(h);
  h.phone.protocolClient.close();
  const permission = h.backend.listPendingPermissionCards()[0]!;
  const grant = await h.backend.applyBridgeAction({ type: "permission.decide", permissionRequestId: permission.permissionRequestId, decision: "allow_for_job" });
  assert.equal(grant.ok, true);
  assert.equal(h.backend.getState().jobs.get(created.jobId)?.status, "completed");
  assert.equal(h.phone.store.getAffair(created.affairId).jobs[created.jobId].status, "needs_permission");
  await h.phone.openSession(h.server.wsUrl);
  const stale = await h.backend.applyBridgeAction({ type: "affair.accept", affairId: created.affairId,
    expectedCurrentJobId: "old_visible_job", acceptanceSummary: "用户确认旧结果" });
  assert.equal(stale.ok, false);
  const accepted = await h.backend.applyBridgeAction({ type: "affair.accept", affairId: created.affairId,
    expectedCurrentJobId: created.jobId, acceptanceSummary: "用户确认 3 个文件清单" });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  await waitUntil(() => h.phone.store.getAffair(created.affairId).status === "closed");
  assert.equal(h.phone.store.getAffair(created.affairId).jobs[created.jobId].status, "completed");
  assert.equal(h.phone.store.listActionRecords()[0].origin, "desktop");
});
