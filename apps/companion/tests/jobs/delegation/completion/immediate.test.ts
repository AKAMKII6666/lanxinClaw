/** 真实 backend store 下的即时终态回归，避免宽松测试替身掩盖非法迁移。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../support/harness.js";
import { OpenClawAdapter, createMutableMockOpenClawRuntimeClient } from "@lanxin-claw/openclaw-adapter";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import { JobDelegator } from "../../../../src/jobs/delegation/delegator.js";
import { PermissionGate } from "../../../../src/permissions/gate/permission-gate.js";
import { applyProtocolEnvelopeToState, createCompanionBackendState } from "../../../../src/state/store.js";

function setup(status: "completed" | "failed" | "accepted" = "completed") {
  const state = createCompanionBackendState();
  state.affairs.set("affair_fast", {
    affairId: "affair_fast", title: "只读检查", ownerAgent: "zhang-boss", status: "delegated",
    context: [], acceptanceCriteria: ["返回目录检查结果"], currentJobId: "job_fast",
  });
  state.jobs.set("job_fast", {
    jobId: "job_fast", affairId: "affair_fast", executor: "openclaw", status: "needs_permission",
    goal: "只读检查", allowedPermissions: ["workspace.read"], progressSummary: "等待授权",
  });
  const gate = new PermissionGate();
  gate.enqueue({
    permissionRequestId: "pr_fast", jobId: "job_fast", affairId: "affair_fast", requester: "zhang-boss",
    requestedPermissions: ["workspace.read"], reason: "只读检查", risk: "low", proposedScope: {},
    denyConsequence: "任务停止", requestedAt: new Date().toISOString(), expiresAt: null,
  });
  gate.decide("pr_fast", "allow_for_job");
  const runtime = createMutableMockOpenClawRuntimeClient();
  runtime.client.createRun = async () => ({
    runId: "run_fast", status, summary: status === "failed" ? "读取目录失败" : "目录检查完成，共找到 3 个文件：a.txt、b.txt、c.txt",
  });
  runtime.client.getRun = async (runId) => ({
    runId, status, summary: status === "failed" ? "读取目录失败" : "目录检查完成，共找到 3 个文件：a.txt、b.txt、c.txt",
  });
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const sent: ProtocolEnvelope[] = [];
  let rejectOnce: boolean | string = false;
  const delegator = new JobDelegator({
    adapter, gate,
    getJobStatus: (id) => state.jobs.get(id)?.status,
    getAffair: (id) => state.affairs.get(id),
    getPhoneDeviceId: () => "phone_fast", desktopDeviceId: "desktop_fast",
    applyProtocolEnvelope: (envelope) => {
      if (rejectOnce === true || rejectOnce === envelope.type) {
        rejectOnce = false;
        return { ok: false, code: "temporary_apply_failure", message: "模拟提交失败", retryable: true };
      }
      return applyProtocolEnvelopeToState(state, envelope);
    },
    sendEnvelope: (envelope) => { sent.push(envelope); },
    pollIntervalMs: 10,
  });
  return { state, runtime, adapter, delegator, sent, rejectNextApply: (type?: string) => { rejectOnce = type ?? true; } };
}

test("createRun 即时完成经合法接受事件推进真实 job 和 affair store", async (t) => {
  const h = setup();
  t.after(() => h.delegator.stop());
  await h.delegator.handlePermissionGranted("pr_fast");
  assert.equal(h.state.jobs.get("job_fast")?.status, "completed");
  assert.equal(h.state.affairs.get("affair_fast")?.status, "waiting_acceptance");
  assert.deepEqual(h.sent.filter((e) => e.type.startsWith("job.")).map((e) => e.type), ["job.accepted", "job.completed"]);
  assert.equal(h.state.lastError, null);
  assert.equal(h.delegator.activeJobCount(), 0);
});

test("已有即时完成 run 的 reconcile 也不能被 needs_permission 门闩拒绝", async (t) => {
  const h = setup();
  t.after(() => h.delegator.stop());
  const created = await h.adapter.createJob({ jobId: "job_fast", affairId: "affair_fast", goal: "只读检查", allowedPermissions: ["workspace.read"] });
  assert.equal(created.ok, true);
  await h.delegator.reconcileExistingAdapterRun("job_fast", "affair_fast");
  assert.equal(h.state.jobs.get("job_fast")?.status, "completed");
  assert.equal(h.state.affairs.get("affair_fast")?.status, "waiting_acceptance");
});

test("即时失败不伪造执行已开始", async (t) => {
  const h = setup("failed");
  t.after(() => h.delegator.stop());
  await h.delegator.handlePermissionGranted("pr_fast");
  assert.equal(h.state.jobs.get("job_fast")?.status, "failed");
  assert.equal(h.state.affairs.get("affair_fast")?.status, "blocked");
  assert.equal(h.sent.some((e) => e.type === "job.accepted"), false);
});

test("即时终态 apply 失败不丢失跟踪，后续重试已取得的结果", async (t) => {
  const h = setup();
  t.after(() => h.delegator.stop());
  h.rejectNextApply();
  await h.delegator.handlePermissionGranted("pr_fast");
  assert.equal(h.delegator.activeJobCount(), 1);
  assert.equal(h.sent.length, 0);
  for (let i = 0; i < 100 && h.state.jobs.get("job_fast")?.status !== "completed"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(h.state.jobs.get("job_fast")?.status, "completed");
  assert.equal(h.state.affairs.get("affair_fast")?.status, "waiting_acceptance");
});

test("job 已完成但事务投影提交失败时仍保持跟踪，重试不再读取 runtime", async (t) => {
  const h = setup(); t.after(() => h.delegator.stop());
  let reads = 0;
  h.runtime.client.getRun = async () => { reads++; throw new Error("不应再次读取"); };
  h.rejectNextApply("affair.update");
  await h.delegator.handlePermissionGranted("pr_fast");
  assert.equal(h.state.jobs.get("job_fast")?.status, "completed");
  assert.equal(h.delegator.activeJobCount(), 1);
  await waitFor(() => h.delegator.activeJobCount() === 0);
  assert.equal(reads, 0);
  assert.equal(h.sent.filter((e) => e.type === "affair.update").length, 1);
});

test("不可重试读取错误的失败事实提交受阻时，保留投递而不继续访问 runtime", async (t) => {
  const h = setup("accepted"); t.after(() => h.delegator.stop());
  await h.delegator.handlePermissionGranted("pr_fast");
  let reads = 0;
  h.adapter.readJob = async () => { reads++; return { ok: false, code: "run_missing", message: "执行器确认 run 不存在", retryable: false }; };
  h.rejectNextApply("job.failed");
  await waitFor(() => h.delegator.activeJobCount() === 0);
  assert.equal(reads, 1);
  assert.equal(h.state.jobs.get("job_fast")?.status, "failed");
  assert.equal(h.state.affairs.get("affair_fast")?.status, "blocked");
});

test("未预期 create 异常释放在途占位，不伪造成功或停止证据", async (t) => {
  const h = setup(); t.after(() => h.delegator.stop());
  h.adapter.createJob = async () => { throw new Error("unexpected_adapter_throw"); };
  await assert.rejects(h.delegator.handlePermissionGranted("pr_fast"), /unexpected_adapter_throw/);
  assert.equal(h.delegator.activeJobCount(), 0);
  assert.equal(h.state.jobs.get("job_fast")?.status, "needs_permission");
  assert.equal(h.sent.length, 0);
});
