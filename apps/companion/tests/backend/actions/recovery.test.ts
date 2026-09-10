/** 关闭持久化与恢复反例：真实文件镜像、提交失败、多个子 job。 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEnvelope, type AffairClosePayload } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../../src/backend/runtime.js";
import { createFileBackendMirrorStore } from "../../../src/state/mirror/backend-mirror.js";

const request = { actorId: "phone_recovery", requestId: "original_close", command: {
  affairId: "affair_recovery", status: "canceled", expectedCurrentJobId: "job_main", closeReason: "用户取消",
} satisfies AffairClosePayload };

function seed(backend: ReturnType<typeof createCompanionBackendRuntime>) {
  const state = backend.getState();
  state.affairs.set(request.command.affairId, { affairId: request.command.affairId, title: "恢复测试", ownerAgent: "zhang-boss",
    status: "running", context: [], acceptanceCriteria: ["检查结果"], currentJobId: "job_main" });
  for (const [jobId, status] of [["job_main", "running"], ["job_explore", "blocked"], ["job_finished", "completed"]] as const) {
    state.jobs.set(jobId, { jobId, affairId: request.command.affairId, executor: "openclaw", status,
      purpose: jobId === "job_explore" ? "exploration" : "execution", goal: "检查目录", allowedPermissions: ["workspace.read"] });
  }
}

function ports(backend: ReturnType<typeof createCompanionBackendRuntime>, canceled: string[]) {
  return { desktopDeviceId: "desktop_recovery", sendEnvelope: () => {}, cancelJob: async ({ jobId }: { jobId: string }) => {
    canceled.push(jobId);
    const job = backend.getState().jobs.get(jobId)!;
    const applied = backend.applyProtocolEnvelope(createEnvelope({ source: { kind: "companion", deviceId: "desktop_recovery" }, target: { kind: "phone", deviceId: "phone_recovery" },
      type: "job.canceled", payload: { ...job, status: "canceled" } }));
    assert.equal(applied.ok, true);
  } };
}

test("ack 丢失后重启仍返回原提交结果，不重复取消且保留已完成 job", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lanxin-action-recovery-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const mirrorStore = createFileBackendMirrorStore(path.join(directory, "mirror.json"));
  const backend = createCompanionBackendRuntime({ mirrorStore }); seed(backend);
  const canceled: string[] = [];
  const first = await backend.getAffairActions().execute(request, { ...ports(backend, canceled), sendEnvelope: () => { throw new Error("ack lost"); } });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(canceled, ["job_main", "job_explore"]);
  assert.equal(backend.getState().jobs.get("job_finished")?.status, "completed");
  const restarted = createCompanionBackendRuntime({ mirrorStore });
  const replay = await restarted.getAffairActions().execute(request, ports(restarted, canceled));
  assert.equal(replay.ok, true);
  if (first.ok && replay.ok) { assert.equal(replay.duplicate, true); assert.deepEqual(replay.result, first.result); }
  assert.equal(canceled.length, 2);
});

test("缺取消 handler 不伪造终态，重启恢复 pending 围栏后继续原请求", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lanxin-action-pending-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const mirrorStore = createFileBackendMirrorStore(path.join(directory, "mirror.json"));
  const backend = createCompanionBackendRuntime({ mirrorStore }); seed(backend);
  const failed = await backend.getAffairActions().execute(request, { desktopDeviceId: "desktop_recovery", sendEnvelope: () => {} });
  assert.equal(failed.ok, false);
  assert.equal(backend.getState().affairs.get(request.command.affairId)?.status, "running");
  const restarted = createCompanionBackendRuntime({ mirrorStore });
  assert.equal(restarted.getAffairActions().isClosing(request.command.affairId), true);
  assert.match(restarted.getSnapshot().currentAffair?.progressSummary ?? "", /取消待确认/);
  assert.equal((await restarted.getAffairActions().recoverPending(ports(restarted, [])))[0]?.ok, true);
  assert.equal(restarted.getAffairActions().isClosing(request.command.affairId), false);
});

test("父终态与结果落盘失败时保留 pending，已停止的 job 不回滚成在跑", async () => {
  const memory = createFileBackendMirrorStore(path.join(mkdtempSync(path.join(os.tmpdir(), "lanxin-action-save-")), "mirror.json"));
  let rejectCommit = true;
  const backend = createCompanionBackendRuntime({ mirrorStore: { load: memory.load, save: (root) => {
    if (rejectCommit && root.affairActions?.some((action) => action.phase === "committed")) throw new Error("disk full");
    memory.save(root);
  } } }); seed(backend);
  const canceled: string[] = [];
  const first = await backend.getAffairActions().execute(request, ports(backend, canceled));
  assert.equal(first.ok, false);
  assert.notEqual(backend.getState().affairs.get(request.command.affairId)?.status, "canceled");
  assert.equal(backend.getState().jobs.get("job_main")?.status, "canceled");
  assert.equal(backend.getAffairActions().isClosing(request.command.affairId), true);
  rejectCommit = false;
  assert.equal((await backend.getAffairActions().execute(request, ports(backend, canceled))).ok, true);
  assert.equal(canceled.length, 2);
});

test("通用 apply 无法绕过共同关闭入口", () => {
  const backend = createCompanionBackendRuntime(); seed(backend);
  const affair = backend.getState().affairs.get(request.command.affairId)!;
  const applied = backend.applyProtocolEnvelope(createEnvelope({ source: { kind: "companion", deviceId: "desktop_recovery" }, target: { kind: "phone", deviceId: "phone_recovery" },
    type: "affair.update", payload: { ...affair, status: "canceled" } }));
  assert.equal(applied.ok, false);
  assert.equal(backend.getState().affairs.get(affair.affairId)?.status, "running");
});
