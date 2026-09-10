/**
 * JobDelegator 测试：授权后自动委派、状态回推、终态停轮询、幂等。
 */

import {
OpenClawAdapter,
createMutableMockOpenClawRuntimeClient
} from "@lanxin-claw/openclaw-adapter";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JobDelegator } from "../../../src/jobs/delegation/delegator.js";
import {
buildDelegationFailureJob,
buildRuntimeReadFailureJob,
} from "../../../src/jobs/delegation/projection/delegator-outbound.js";
import { jobStatusFingerprint } from "../../../src/jobs/delegation/projection/job-status-fingerprint.js";
import { PermissionGate } from "../../../src/permissions/gate/permission-gate.js";

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
  // secrets.read 用 allow_once 验证消耗语义。
  gate.enqueue({
    permissionRequestId: "pr_test_once",
    jobId: "job_test_once",
    affairId: "affair_test_001",
    requester: "zhang-boss",
    requestedPermissions: ["secrets.read"],
    reason: "test goal",
    risk: "high",
    proposedScope: { workspaceRoot: "F:/ws" },
    denyConsequence: "停住",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });
  gate.decide("pr_test_once", "allow_once");
  assert.equal(gate.hasGrant("job_test_once", "secrets.read"), true);
  await delegator.handlePermissionGranted("pr_test_once");

  assert.equal(broadcasts.filter((e) => e.type === "job.accepted").length, 1);
  assert.equal(gate.isGranted("job_test_once", "secrets.read"), false);
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
    requestedPermissions: ["secrets.read"],
    reason: "test goal",
    risk: "high",
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
  assert.equal(gate.hasGrant("job_once_fail", "secrets.read"), true);
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

import { createHarness, enqueueAndDecide } from "./support/harness.js";
