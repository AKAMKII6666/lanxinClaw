/** 轮询与终态发布；从原合同测试按职责拆出，用例与断言保持完整。 */
import {
GatewayTransportError
} from "@lanxin-claw/openclaw-adapter";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness, enqueueAndDecide, waitFor } from "../support/harness.js";

test("状态变化回推：completed → job.completed，终态停轮询", async () => {
  const { gate, adapter, runtime, broadcasts, jobStatuses, affairStatuses, delegator } = createHarness(30);
  jobStatuses.set("job_test_002", "needs_permission");
  affairStatuses.set("affair_test_001", "delegated");
  enqueueAndDecide(gate, "pr_test_002", "job_test_002", "allow_for_job");
  await delegator.handlePermissionGranted("pr_test_002");

  const read = await adapter.readJob("job_test_002");
  assert.ok(read.ok);
  const runId = read.ok ? read.job.openclawRunId : null;
  assert.ok(runId);

  runtime.advance({
    runId: runId ?? "",
    status: "completed",
    patch: { summary: "任务结果已整理完成：list_root count=3" },
  });
  affairStatuses.set("affair_test_001", "waiting_acceptance");

  await waitFor(() => broadcasts.some((e) => e.type === "job.completed"));
  const completed = broadcasts.find((e) => e.type === "job.completed");
  const payload = completed?.payload as { jobId?: string; status?: string };
  assert.equal(payload.jobId, "job_test_002");
  assert.equal(payload.status, "completed");
  const affairUpdate = broadcasts.find(
    (e) =>
      e.type === "affair.update" &&
      (e.payload as { affairId?: string }).affairId === "affair_test_001" &&
      (e.payload as { status?: string }).status === "waiting_acceptance",
  );
  assert.ok(affairUpdate, "completed 后应广播 affair.update");
  assert.equal(
    (affairUpdate?.payload as { status?: string }).status,
    "waiting_acceptance",
  );
  await waitFor(() => delegator.activeJobCount() === 0);
  delegator.stop();
});

test("同 status 但进度摘要变化也广播 job.progress", async () => {
  const { gate, adapter, runtime, broadcasts, jobStatuses, delegator } = createHarness(30);
  jobStatuses.set("job_progress_same_status", "needs_permission");
  enqueueAndDecide(gate, "pr_progress_same_status", "job_progress_same_status", "allow_for_job");
  await delegator.handlePermissionGranted("pr_progress_same_status");

  const read = await adapter.readJob("job_progress_same_status");
  assert.ok(read.ok);
  const runId = read.ok ? read.job.openclawRunId : null;
  assert.ok(runId);

  runtime.advance({
    runId: runId ?? "",
    status: "running",
    patch: { summary: "正在检查浏览器策略限制" },
  });

  await waitFor(() =>
    broadcasts.some(
      (e) =>
        e.type === "job.progress" &&
        (e.payload as { progressSummary?: string }).progressSummary === "正在检查浏览器策略限制",
    ),
  );
  assert.equal(delegator.activeJobCount(), 1);
  delegator.stop();
});

test("轮询遇到非可重试读取失败时广播 job.failed 并停止轮询", async () => {
  const { gate, adapter, runtime, broadcasts, jobStatuses, delegator } = createHarness(30);
  jobStatuses.set("job_read_fail", "needs_permission");
  enqueueAndDecide(gate, "pr_read_fail", "job_read_fail", "allow_for_job");
  await delegator.handlePermissionGranted("pr_read_fail");

  const read = await adapter.readJob("job_read_fail", { refresh: false });
  assert.ok(read.ok);
  runtime.client.getRun = async () => {
    throw new GatewayTransportError(
      "INVALID_REQUEST",
      "missing scope: operator.write token=abcdefghijklmnop",
      false,
    );
  };

  await waitFor(() => broadcasts.some((e) => e.type === "job.failed"));
  const failed = broadcasts.find((e) => e.type === "job.failed");
  const payload = failed?.payload as {
    jobId?: string;
    status?: string;
    statusReasonCode?: string | null;
    progressSummary?: string;
  };
  assert.equal(payload.jobId, "job_read_fail");
  assert.equal(payload.status, "failed");
  assert.equal(payload.statusReasonCode, "INVALID_REQUEST");
  assert.match(payload.progressSummary ?? "", /missing scope/);
  assert.equal((payload.progressSummary ?? "").includes("abcdefghijklmnop"), false);
  assert.equal(delegator.activeJobCount(), 0);
  delegator.stop();
});

test("同一 job 轮询串行，不重叠读取状态", async () => {
  const { gate, runtime, jobStatuses, delegator } = createHarness(5);
  jobStatuses.set("job_serial_poll", "needs_permission");
  enqueueAndDecide(gate, "pr_serial_poll", "job_serial_poll", "allow_for_job");
  await delegator.handlePermissionGranted("pr_serial_poll");

  let readCalls = 0;
  let releaseRead = (): void => undefined;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  runtime.client.getRun = async (runId) => {
    readCalls += 1;
    await readGate;
    return { runId, status: "running", summary: "still working" };
  };

  await waitFor(() => readCalls === 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(readCalls, 1);
  delegator.stop();
  releaseRead();
});

test("恢复轮询时若 adapter 已终态，先广播终态再停止", async () => {
  const { adapter, runtime, broadcasts, jobStatuses, affairStatuses, delegator } = createHarness();
  const created = await adapter.createJob({
    jobId: "job_restore_done",
    affairId: "affair_restore_done",
    goal: "restore finished job",
    workspaceHint: "F:/ws",
    allowedPermissions: ["workspace.read"],
  });
  assert.ok(created.ok);
  if (!created.ok) {
    return;
  }
  jobStatuses.set("job_restore_done", "running");
  affairStatuses.set("affair_restore_done", "waiting_acceptance");
  runtime.advance({
    runId: created.job.openclawRunId ?? "",
    status: "completed",
    patch: { summary: "done while companion was restarting: list_root count=2" },
  });

  await delegator.restoreInFlightPolling(["job_restore_done"]);

  const completed = broadcasts.find((e) => e.type === "job.completed");
  assert.ok(completed);
  assert.equal((completed.payload as { jobId?: string }).jobId, "job_restore_done");
  assert.equal(jobStatuses.get("job_restore_done"), "completed");
  assert.equal(delegator.activeJobCount(), 0);
  delegator.stop();
});

test("blocked 广播后停止普通轮询", async () => {
  const { gate, adapter, runtime, broadcasts, jobStatuses, delegator } = createHarness(30);
  jobStatuses.set("job_block_stop", "needs_permission");
  enqueueAndDecide(gate, "pr_block_stop", "job_block_stop", "allow_for_job");
  await delegator.handlePermissionGranted("pr_block_stop");

  const read = await adapter.readJob("job_block_stop");
  assert.ok(read.ok);
  const runId = read.ok ? read.job.openclawRunId : null;
  assert.ok(runId);

  runtime.advance({
    runId: runId ?? "",
    status: "blocked",
    patch: {
      summary: "浏览器受策略限制",
      blockedReason: "浏览器受策略限制，无法打开页面",
      resumeCondition: "确认是否改用抓取新闻内容",
    },
  });

  await waitFor(() => broadcasts.some((e) => e.type === "job.blocked"));
  await waitFor(() => delegator.activeJobCount() === 0);
  const blocked = broadcasts.find((e) => e.type === "job.blocked");
  assert.match((blocked?.payload as { blockedReason?: string }).blockedReason ?? "", /策略限制/);
  delegator.stop();
});
