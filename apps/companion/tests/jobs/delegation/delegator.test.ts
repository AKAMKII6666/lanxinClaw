/**
 * JobDelegator 测试：授权后自动委派、状态回推、终态停轮询、幂等。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GatewayTransportError,
  OpenClawAdapter,
  createMutableMockOpenClawRuntimeClient,
} from "@lanxin-claw/openclaw-adapter";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import { JobDelegator } from "../../../src/jobs/delegation/delegator.js";
import {
  buildDelegationFailureJob,
  buildRuntimeReadFailureJob,
} from "../../../src/jobs/delegation/projection/delegator-outbound.js";
import { jobStatusFingerprint } from "../../../src/jobs/delegation/projection/job-status-fingerprint.js";
import { PermissionGate } from "../../../src/permissions/gate/permission-gate.js";

/**
 * 测试 harness。
 *
 * @returns 依赖
 */
function createHarness(pollIntervalMs = 30) {
  const gate = new PermissionGate();
  const runtime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const broadcasts: ProtocolEnvelope[] = [];
  const jobStatuses = new Map<string, string>();
  const affairStatuses = new Map<string, string>();
  const affairCurrentJobIds = new Map<string, string | null>();
  const workspaceHints = new Map<string, string | null>();
  const delegator = new JobDelegator({
    adapter,
    gate,
    getJobStatus: (jobId) => jobStatuses.get(jobId),
    getWorkspaceHint: (jobId) =>
      workspaceHints.has(jobId) ? workspaceHints.get(jobId) : "F:/ws",
    getAffair: (affairId) =>
      ({
        affairId,
        title: "test affair",
        ownerAgent: "zhang-boss",
        status: (affairStatuses.get(affairId) ?? "running") as string,
        context: [],
        acceptanceCriteria: [],
        currentJobId: affairCurrentJobIds.has(affairId)
          ? affairCurrentJobIds.get(affairId)
          : gate.dump().requests.find((request) => request.affairId === affairId)?.jobId ?? null,
      } as never),
    getPhoneDeviceId: () => "phone_test_001",
    desktopDeviceId: "desktop_test_001",
    applyProtocolEnvelope: (envelope) => {
      const payload = envelope.payload as { jobId?: string; status?: string };
      if (payload.jobId && payload.status) {
        jobStatuses.set(payload.jobId, payload.status);
      }
      return { ok: true, envelope };
    },
    sendEnvelope: (envelope) => {
      broadcasts.push(envelope);
    },
    pollIntervalMs,
  });
  return { gate, runtime, adapter, broadcasts, jobStatuses, affairStatuses, affairCurrentJobIds, workspaceHints, delegator };
}

/**
 * 入队并裁决一条权限请求。
 *
 * @param gate gate
 * @param permissionRequestId 请求 id
 * @param jobId job id
 * @param decision 决策
 */
function enqueueAndDecide(
  gate: PermissionGate,
  permissionRequestId: string,
  jobId: string,
  decision: string,
) {
  gate.enqueue({
    permissionRequestId,
    jobId,
    affairId: "affair_test_001",
    requester: "zhang-boss",
    requestedPermissions: ["workspace.read"],
    reason: "test goal",
    risk: "low",
    proposedScope: { workspaceRoot: "F:/ws" },
    denyConsequence: "job 停住",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });
  return gate.decide(permissionRequestId, decision);
}

/**
 * 等待条件成立。
 *
 * @param predicate 条件
 * @param timeoutMs 超时
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("授权后自动委派并广播 job.accepted", async () => {
  const { gate, adapter, broadcasts, jobStatuses, delegator } = createHarness();
  jobStatuses.set("job_test_001", "needs_permission");
  enqueueAndDecide(gate, "pr_test_001", "job_test_001", "allow_for_job");
  await delegator.handlePermissionGranted("pr_test_001");

  const accepted = broadcasts.filter((e) => e.type === "job.accepted");
  assert.equal(accepted.length, 1);
  const payload = accepted[0]?.payload as { jobId?: string; status?: string };
  assert.equal(payload.jobId, "job_test_001");
  const read = await adapter.readJob("job_test_001");
  assert.ok(read.ok);
  if (read.ok) {
    assert.ok(read.job.openclawRunId);
  }
  assert.equal(delegator.activeJobCount(), 1);
  delegator.stop();
});

test("createRun 同步返回失败状态时广播 job.failed 而非 job.accepted", async () => {
  const { gate, runtime, broadcasts, jobStatuses, delegator } = createHarness();
  runtime.client.createRun = async () => ({
    runId: "run_immediate_failed",
    status: "failed",
    summary: "runtime crashed before executing",
  });
  jobStatuses.set("job_immediate_failed", "needs_permission");
  enqueueAndDecide(gate, "pr_immediate_failed", "job_immediate_failed", "allow_for_job");

  await delegator.handlePermissionGranted("pr_immediate_failed");

  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 0);
  const failed = broadcasts.find((e) => e.type === "job.failed");
  assert.ok(failed);
  assert.equal((failed.payload as { status?: string }).status, "failed");
  assert.equal(delegator.activeJobCount(), 0);
  delegator.stop();
});

test("allow_once 在 createRun 成功后消耗 grant", async () => {
  const { gate, broadcasts, jobStatuses, delegator } = createHarness();
  jobStatuses.set("job_test_once", "needs_permission");
  enqueueAndDecide(gate, "pr_test_once", "job_test_once", "allow_once");
  assert.equal(gate.hasGrant("job_test_once", "workspace.read"), true);
  await delegator.handlePermissionGranted("pr_test_once");

  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 1);
  assert.equal(gate.isGranted("job_test_once", "workspace.read"), false);
  delegator.stop();
});

test("allow_once 在 createRun 失败时不消耗 grant", async () => {
  const gate = new PermissionGate();
  const runtime = createMutableMockOpenClawRuntimeClient();
  runtime.client.createRun = async () => {
    throw new Error("mock_create_fail");
  };
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const broadcasts: ProtocolEnvelope[] = [];
  const jobStatuses = new Map<string, string>([["job_once_fail", "needs_permission"]]);
  const delegator = new JobDelegator({
    adapter,
    gate,
    getJobStatus: (jobId) => jobStatuses.get(jobId),
    getWorkspaceHint: () => "F:/ws",
    authorizedDesktopRoot: "F:/ws",
    getPhoneDeviceId: () => "phone_test_001",
    desktopDeviceId: "desktop_test_001",
    applyProtocolEnvelope: (envelope) => {
      const payload = envelope.payload as { jobId?: string; status?: string };
      if (payload.jobId && payload.status) {
        jobStatuses.set(payload.jobId, payload.status);
      }
      return { ok: true, envelope };
    },
    sendEnvelope: (envelope) => broadcasts.push(envelope),
    pollIntervalMs: 30,
  });
  gate.enqueue({
    permissionRequestId: "pr_once_fail",
    jobId: "job_once_fail",
    affairId: "affair_test_001",
    requester: "zhang-boss",
    requestedPermissions: ["workspace.read"],
    reason: "test goal",
    risk: "low",
    proposedScope: { workspaceRoot: "F:/ws" },
    denyConsequence: "停住",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });
  gate.decide("pr_once_fail", "allow_once");
  await delegator.handlePermissionGranted("pr_once_fail");
  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 0);
  const failed = broadcasts.find((e) => e.type === "job.failed");
  assert.ok(failed);
  const failedPayload = failed.payload as { goal?: string; statusReasonCode?: string };
  assert.equal(failedPayload.goal, "test goal");
  assert.equal(failedPayload.statusReasonCode, "runtime_create_failed");
  assert.equal(gate.hasGrant("job_once_fail", "workspace.read"), true);
  delegator.stop();
});

test("并发 handlePermissionGranted 仅一次 createRun", async () => {
  const { gate, adapter, broadcasts, jobStatuses, delegator } = createHarness();
  jobStatuses.set("job_concurrent", "needs_permission");
  enqueueAndDecide(gate, "pr_concurrent", "job_concurrent", "allow_for_job");
  await Promise.all([
    delegator.handlePermissionGranted("pr_concurrent"),
    delegator.handlePermissionGranted("pr_concurrent"),
  ]);
  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 1);
  const read = await adapter.readJob("job_concurrent");
  assert.ok(read.ok);
  delegator.stop();
});

test("无 phoneDeviceId 时 deny 仍 apply backend job=failed", async () => {
  const gate = new PermissionGate();
  const runtime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const broadcasts: ProtocolEnvelope[] = [];
  const jobStatuses = new Map<string, string>([["job_no_phone", "needs_permission"]]);
  const delegator = new JobDelegator({
    adapter,
    gate,
    getJobStatus: (jobId) => jobStatuses.get(jobId),
    getPhoneDeviceId: () => null,
    desktopDeviceId: "desktop_test_001",
    applyProtocolEnvelope: (envelope) => {
      const payload = envelope.payload as { jobId?: string; status?: string };
      if (payload.jobId && payload.status) {
        jobStatuses.set(payload.jobId, payload.status);
      }
      return { ok: true, envelope };
    },
    sendEnvelope: (envelope) => broadcasts.push(envelope),
    pollIntervalMs: 30,
  });
  gate.enqueue({
    permissionRequestId: "pr_no_phone",
    jobId: "job_no_phone",
    affairId: "affair_x",
    requester: "zhang-boss",
    requestedPermissions: ["workspace.read"],
    reason: "test",
    risk: "low",
    proposedScope: { workspaceRoot: "F:/ws" },
    denyConsequence: "停住",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });
  gate.decide("pr_no_phone", "deny");
  delegator.rejectPermission("pr_no_phone", "permission_denied");
  assert.equal(jobStatuses.get("job_no_phone"), "failed");
  assert.equal(broadcasts.length, 0);
  delegator.stop();
});

test("deny 决策广播 job.failed 且不委派", async () => {
  const { gate, broadcasts, jobStatuses, delegator } = createHarness();
  jobStatuses.set("job_test_003", "needs_permission");
  enqueueAndDecide(gate, "pr_test_003", "job_test_003", "deny");
  delegator.rejectPermission("pr_test_003", "permission_denied");
  assert.equal(delegator.activeJobCount(), 0);
  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 0);
  assert.ok(broadcasts.some((e) => e.type === "job.failed"));
});

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

test("重复决策幂等：不二次委派", async () => {
  const { gate, broadcasts, jobStatuses, delegator } = createHarness();
  jobStatuses.set("job_test_004", "needs_permission");
  enqueueAndDecide(gate, "pr_test_004", "job_test_004", "allow_for_job");
  await delegator.handlePermissionGranted("pr_test_004");
  await delegator.handlePermissionGranted("pr_test_004");
  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 1);
  delegator.stop();
});

test("job 不在 needs_permission 时跳过委派", async () => {
  const { gate, broadcasts, jobStatuses, delegator } = createHarness();
  jobStatuses.set("job_test_005", "running");
  enqueueAndDecide(gate, "pr_test_005", "job_test_005", "allow_for_job");
  await delegator.handlePermissionGranted("pr_test_005");
  assert.equal(delegator.activeJobCount(), 0);
  assert.equal(broadcasts.length, 0);
});

test("父事务已终态时 handlePermissionGranted 不 createRun", async () => {
  const { gate, broadcasts, jobStatuses, affairStatuses, adapter, delegator } = createHarness();
  jobStatuses.set("job_terminal_parent", "needs_permission");
  affairStatuses.set("affair_test_001", "canceled");
  enqueueAndDecide(gate, "pr_terminal_parent", "job_terminal_parent", "allow_for_job");
  await delegator.handlePermissionGranted("pr_terminal_parent");
  assert.equal(delegator.activeJobCount(), 0);
  assert.equal(broadcasts.length, 0);
  const read = await adapter.readJob("job_terminal_parent");
  assert.equal(read.ok, false);
});

test("权限请求不属于当前 job 时 handlePermissionGranted 不 createRun", async () => {
  const { gate, broadcasts, jobStatuses, affairStatuses, affairCurrentJobIds, adapter, delegator } = createHarness();
  jobStatuses.set("job_old_permission", "needs_permission");
  affairStatuses.set("affair_test_001", "running");
  affairCurrentJobIds.set("affair_test_001", "job_current_permission");
  gate.enqueue({
    permissionRequestId: "pr_old_permission",
    jobId: "job_old_permission",
    affairId: "affair_test_001",
    requester: "zhang-boss",
    requestedPermissions: ["workspace.read"],
    reason: "test goal",
    risk: "low",
    proposedScope: { workspaceRoot: "F:/ws" },
    denyConsequence: "job 停住",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });
  gate.decide("pr_old_permission", "allow_for_job");
  await delegator.handlePermissionGranted("pr_old_permission");
  assert.equal(delegator.activeJobCount(), 0);
  assert.equal(broadcasts.length, 0);
  const read = await adapter.readJob("job_old_permission");
  assert.equal(read.ok, false);
});

test("父事务没有 currentJobId 时 handlePermissionGranted 不 createRun", async () => {
  const { gate, broadcasts, jobStatuses, affairStatuses, affairCurrentJobIds, adapter, delegator } = createHarness();
  jobStatuses.set("job_without_current", "needs_permission");
  affairStatuses.set("affair_test_001", "running");
  affairCurrentJobIds.set("affair_test_001", null);
  enqueueAndDecide(gate, "pr_without_current", "job_without_current", "allow_for_job");
  await delegator.handlePermissionGranted("pr_without_current");
  assert.equal(delegator.activeJobCount(), 0);
  assert.equal(broadcasts.length, 0);
  const read = await adapter.readJob("job_without_current");
  assert.equal(read.ok, false);
});

test("cancelJob：取消 adapter run、广播 canceled、停轮询", async () => {
  const { gate, adapter, broadcasts, jobStatuses, delegator } = createHarness(30);
  jobStatuses.set("job_cancel_001", "needs_permission");
  enqueueAndDecide(gate, "pr_cancel_001", "job_cancel_001", "allow_for_job");
  await delegator.handlePermissionGranted("pr_cancel_001");

  const read = await adapter.readJob("job_cancel_001");
  assert.ok(read.ok);
  const runId = read.ok ? read.job.openclawRunId : null;
  assert.ok(runId);
  assert.equal(delegator.activeJobCount(), 1);

  await delegator.cancelJob({ jobId: "job_cancel_001", affairId: "affair_test_001" });
  const canceled = broadcasts.find(
    (e) =>
      e.type === "job.canceled" &&
      (e.payload as { jobId?: string; status?: string }).jobId === "job_cancel_001" &&
      (e.payload as { status?: string }).status === "canceled",
  );
  assert.ok(canceled, "应广播 canceled 状态");
  assert.equal(delegator.activeJobCount(), 0, "取消后停止轮询");
  const after = await adapter.readJob("job_cancel_001");
  assert.ok(after.ok);
  if (after.ok) {
    assert.equal(after.job.status, "canceled");
  }
  delegator.stop();
});

test("cancelJob：adapter 取消失败时抛错且不广播", async () => {
  const { gate, jobStatuses, broadcasts, delegator } = createHarness();
  jobStatuses.set("job_cancel_missing", "needs_permission");
  enqueueAndDecide(gate, "pr_cancel_missing", "job_cancel_missing", "allow_for_job");
  await delegator.handlePermissionGranted("pr_cancel_missing");
  const before = broadcasts.length;
  await assert.rejects(
    () => delegator.cancelJob({ jobId: "job_not_exists", affairId: "affair_x" }),
    /找不到|not_found/,
  );
  assert.equal(broadcasts.length, before);
  delegator.stop();
});

test("空 requestedPermissions 拒绝委派且不 createRun", async () => {
  const { gate, broadcasts, jobStatuses, adapter, delegator } = createHarness();
  jobStatuses.set("job_empty", "needs_permission");
  gate.enqueue({
    permissionRequestId: "pr_empty",
    jobId: "job_empty",
    affairId: "affair_test_001",
    requester: "zhang-boss",
    requestedPermissions: [],
    reason: "empty",
    risk: "low",
    proposedScope: { workspaceRoot: "F:/ws" },
    denyConsequence: "停住",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });
  gate.decide("pr_empty", "allow_for_job");
  await delegator.handlePermissionGranted("pr_empty");
  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 0);
  assert.equal(broadcasts.some((e) => e.type === "job.progress" || e.type === "job.failed"), true);
  const failed = broadcasts.find((e) => e.type === "job.failed");
  assert.ok(failed);
  const failedPayload = failed.payload as { goal?: string; statusReasonCode?: string };
  assert.equal(failedPayload.goal, "empty");
  assert.equal(failedPayload.statusReasonCode, "lanxin.empty_permissions");
  const read = await adapter.readJob("job_empty");
  assert.equal(read.ok, false);
  delegator.stop();
});

test("workspaceHint 越出授权根时拒绝 createRun", async () => {
  const { gate, broadcasts, jobStatuses, workspaceHints, adapter, delegator } = createHarness();
  jobStatuses.set("job_scope", "needs_permission");
  workspaceHints.set("job_scope", "F:/other");
  enqueueAndDecide(gate, "pr_scope", "job_scope", "allow_for_job");
  await delegator.handlePermissionGranted("pr_scope");
  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 0);
  const failed = broadcasts.find((e) => e.type === "job.failed" || (e.type === "job.progress" && (e.payload as { status?: string }).status === "failed"));
  assert.ok(failed, "应广播失败");
  const failedPayload = failed.payload as { goal?: string; statusReasonCode?: string };
  assert.equal(failedPayload.goal, "test goal");
  assert.equal(failedPayload.statusReasonCode, "workspace_scope_mismatch");
  const read = await adapter.readJob("job_scope");
  assert.equal(read.ok, false);
  delegator.stop();
});

test("buildDelegationFailureJob 把人话 reason 写入 resultDigest 且 evidenceQuality=weak", () => {
  const job = buildDelegationFailureJob(
    "job_fail",
    "affair_fail",
    "OpenClaw Gateway 不可达",
    "lanxin.delegation_failed",
    { goal: "列桌面", allowedPermissions: ["workspace.read"] },
  );
  assert.equal(job.progressSummary, "OpenClaw Gateway 不可达");
  assert.equal(job.blockedReason, "OpenClaw Gateway 不可达");
  assert.equal(job.resultDigest, "OpenClaw Gateway 不可达");
  assert.equal(job.evidenceQuality, "weak");
});

test("buildRuntimeReadFailureJob 把人话 reason 写入 resultDigest 且 evidenceQuality=weak", () => {
  const job = buildRuntimeReadFailureJob(
    {
      jobId: "job_read",
      affairId: "affair_read",
      goal: "跑测试",
      allowedPermissions: ["command.run"],
      progressSummary: "running",
      recentSteps: [{ at: "2026-09-06T03:00:00.000Z", kind: "tool", text: "command.run" }],
      resultDigest: null,
      evidenceQuality: "weak",
      blockedReason: null,
      resumeCondition: null,
    },
    "读取 OpenClaw run 失败：timeout",
    "runtime_read_failed",
  );
  assert.equal(job.progressSummary, "读取 OpenClaw run 失败：timeout");
  assert.equal(job.blockedReason, "读取 OpenClaw run 失败：timeout");
  assert.equal(job.resultDigest, "读取 OpenClaw run 失败：timeout");
  assert.equal(job.evidenceQuality, "weak");
  assert.equal(job.recentSteps?.length, 1);
});

test("jobStatusFingerprint 仅 recentSteps 变化也会变", () => {
  const base = {
    status: "running" as const,
    progressSummary: "执行中",
    blockedReason: null,
    resumeCondition: null,
    statusReasonCode: "openclaw.running",
    resultDigest: null,
    evidenceQuality: "weak" as const,
    recentSteps: [{ at: "2026-09-06T03:00:00.000Z", kind: "tool" as const, text: "workspace.list" }],
  };
  const next = {
    ...base,
    recentSteps: [
      ...base.recentSteps,
      { at: "2026-09-06T03:00:05.000Z", kind: "tool" as const, text: "workspace.list: listing desktop" },
    ],
  };
  assert.notEqual(jobStatusFingerprint(base), jobStatusFingerprint(next));
});
