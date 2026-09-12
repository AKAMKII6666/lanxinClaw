/** 当前 job 的明确创建权威；真实两端 store/WS 与权限门闩。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { startCrossRepoHarness, waitUntil } from "./harness.js";

test("旧 job 失败后明确创建新 job，两端当前对象一致且可重新授权", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  const args = { title: "重试检查", goal: "第一次检查目录", acceptance_criteria: ["返回检查结果"], allowed_permissions: ["workspace.read"] };
  const first = await h.phone.createJobFromTool(args);
  const permission = h.backend.listPendingPermissionCards()[0]!;
  h.backend.getPermissionGate().decide(permission.permissionRequestId, "deny");
  h.delegator.rejectPermission(permission.permissionRequestId, "用户拒绝第一次任务");
  await waitUntil(() => h.phone.store.getAffair(first.affairId)?.jobs[first.jobId]?.status === "failed");
  const second = await h.phone.createJobFromTool({ ...args, affair_id: first.affairId, goal: "第二次只读检查目录" });
  assert.equal(second.status, "needs_permission");
  assert.equal(h.backend.getState().affairs.get(first.affairId)?.currentJobId, second.jobId);
  assert.equal(h.phone.store.getAffair(first.affairId).currentJobId, second.jobId);
  const next = h.backend.listPendingPermissionCards()[0]!;
  const granted = await h.backend.applyBridgeAction({ type: "permission.decide", permissionRequestId: next.permissionRequestId, decision: "allow_for_job" });
  assert.equal(granted.ok, true, JSON.stringify(granted));
});

test("当前任务未停止时 phone 本地和 WS 服务端均拒绝替换，当前对象不变", async (t) => {
  const h = await startCrossRepoHarness(); t.after(h.close);
  const args = { title: "当前任务", goal: "保持第一次检查", acceptance_criteria: ["检查结果"], allowed_permissions: ["workspace.read"] };
  const first = await h.phone.createJobFromTool(args);
  const refused = await h.phone.createJobFromTool({ ...args, affair_id: first.affairId, goal: "另一项检查" });
  assert.equal(refused.reason, "current_job_not_stopped");
  const request = h.phone.protocolClient.requestPhone(h.ids, "job.create", {
    affairId: first.affairId, jobId: "job_unwanted", status: "queued", executor: "openclaw", goal: "不能覆盖", allowedPermissions: ["workspace.read"],
  });
  const ack = await request.result;
  assert.equal(ack.ok, false); assert.equal(ack.error.code, "current_job_not_stopped");
  assert.equal(h.backend.getState().affairs.get(first.affairId)?.currentJobId, first.jobId);
  assert.equal(h.phone.store.getAffair(first.affairId).currentJobId, first.jobId);
  assert.equal(h.backend.getState().jobs.has("job_unwanted"), false);
});
