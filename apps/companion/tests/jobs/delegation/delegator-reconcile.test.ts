/**
 * delegator 启动 reconcile 单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OpenClawAdapter,
  createMutableMockOpenClawRuntimeClient,
} from "@lanxin-claw/openclaw-adapter";
import { createCompanionBackendRuntime } from "../../../src/backend/runtime.js";
import { JobDelegator } from "../../../src/jobs/delegation/delegator.js";
import { reconcileDelegatorOnStartup } from "../../../src/jobs/delegation/delegator-reconcile.js";
import { PermissionGate } from "../../../src/permissions/gate/permission-gate.js";

test("adapter 有 run 但 backend needs_permission → reconcile 后 polling active", async () => {
  const gate = new PermissionGate();
  const runtime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const backend = createCompanionBackendRuntime({ permissionGate: gate });

  backend.getState().affairs.set("affair_rec", {
    affairId: "affair_rec",
    title: "rec",
    ownerAgent: "zhang-boss",
    status: "running",
    context: [],
    acceptanceCriteria: [],
    currentJobId: "job_rec",
    blockedReason: null,
    resumeCondition: null,
  });
  backend.getState().jobs.set("job_rec", {
    jobId: "job_rec",
    affairId: "affair_rec",
    executor: "openclaw",
    status: "needs_permission",
    goal: "rec goal",
    workspaceHint: null,
    allowedPermissions: ["workspace.read"],
    progressSummary: "",
    blockedReason: null,
    resumeCondition: null,
    permissionRequestId: "pr_rec",
  });

  await adapter.createJob({
    jobId: "job_rec",
    affairId: "affair_rec",
    goal: "rec goal",
    allowedPermissions: ["workspace.read"],
  });

  const delegator = new JobDelegator({
    adapter,
    gate,
    getJobStatus: (jobId) => backend.getState().jobs.get(jobId)?.status,
    getPhoneDeviceId: () => null,
    desktopDeviceId: "desktop_rec",
    applyProtocolEnvelope: (envelope) => backend.applyProtocolEnvelope(envelope),
    sendEnvelope: () => {},
    pollIntervalMs: 50,
  });

  await reconcileDelegatorOnStartup(delegator, backend, adapter);
  assert.equal(delegator.activeJobCount(), 1);
  assert.notEqual(backend.getState().jobs.get("job_rec")?.status, "needs_permission");
  delegator.stop();
});

test("decided grant + needs_permission → 自动委派", async () => {
  const gate = new PermissionGate();
  const runtime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const backend = createCompanionBackendRuntime({ permissionGate: gate });

  backend.getState().affairs.set("affair_auto", {
    affairId: "affair_auto",
    title: "auto",
    ownerAgent: "zhang-boss",
    status: "running",
    context: [],
    acceptanceCriteria: [],
    currentJobId: "job_auto",
    blockedReason: null,
    resumeCondition: null,
  });
  backend.getState().jobs.set("job_auto", {
    jobId: "job_auto",
    affairId: "affair_auto",
    executor: "openclaw",
    status: "needs_permission",
    goal: "auto goal",
    workspaceHint: null,
    allowedPermissions: ["workspace.read"],
    progressSummary: "",
    blockedReason: null,
    resumeCondition: null,
    permissionRequestId: "pr_auto",
  });

  gate.enqueue({
    permissionRequestId: "pr_auto",
    jobId: "job_auto",
    affairId: "affair_auto",
    requester: "zhang-boss",
    requestedPermissions: ["workspace.read"],
    reason: "auto goal",
    risk: "low",
    proposedScope: {},
    denyConsequence: "停住",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });
  gate.decide("pr_auto", "allow_for_job");

  const delegator = new JobDelegator({
    adapter,
    gate,
    getJobStatus: (jobId) => backend.getState().jobs.get(jobId)?.status,
    authorizedDesktopRoot: process.cwd(),
    getPhoneDeviceId: () => null,
    desktopDeviceId: "desktop_auto",
    applyProtocolEnvelope: (envelope) => backend.applyProtocolEnvelope(envelope),
    sendEnvelope: () => {},
    pollIntervalMs: 50,
  });

  await reconcileDelegatorOnStartup(delegator, backend, adapter);
  const read = await adapter.readJob("job_auto");
  assert.ok(read.ok);
  assert.ok(read.job.openclawRunId);
  delegator.stop();
});
