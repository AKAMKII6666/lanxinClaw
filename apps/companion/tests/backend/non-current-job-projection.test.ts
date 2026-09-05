/**
 * 非当前 job 投影门闩测试。
 *
 * 职责：证明旧 job 迟到事件不会改写 affair currentJobId 或验收态。
 * 不拥有：WebSocket、OpenClaw runtime、renderer。
 * 副作用：仅内存。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../src/backend/runtime.js";

describe("non-current job projection gate", () => {
  it("非当前 job 的 completed 迟到不得把 affair 推到 waiting_acceptance", () => {
    const backend = createCompanionBackendRuntime();
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_non_current",
        title: "当前任务",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: ["当前 job 完成"],
        currentJobId: "job_current",
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "job.progress",
      payload: {
        jobId: "job_current",
        affairId: "affair_non_current",
        executor: "openclaw",
        status: "running",
        purpose: "execution",
        goal: "当前执行",
        allowedPermissions: ["workspace.read"],
        progressSummary: "当前执行中",
      },
    })).ok, true);
    assert.equal(backend.applyProtocolEnvelope(createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "job.completed",
      payload: {
        jobId: "job_old",
        affairId: "affair_non_current",
        executor: "openclaw",
        status: "completed",
        purpose: "execution",
        goal: "旧执行",
        allowedPermissions: ["workspace.read"],
        progressSummary: "旧 job 迟到完成",
      },
    })).ok, true);

    const snapshot = backend.getSnapshot();
    assert.equal(snapshot.currentAffair?.currentJobId, "job_current");
    assert.equal(snapshot.currentAffair?.currentJobStatus, "running");
    assert.equal(snapshot.currentAffair?.status, "running");
    assert.equal(backend.getState().jobs.get("job_old")?.status, "completed");
  });

  it("hydrate 时 currentJobId 指向缺失 job，不用其它 job 猜当前", () => {
    const backend = createCompanionBackendRuntime({
      mirrorStore: {
        load: () => ({
          schemaVersion: 1 as const,
          affairs: [{
            affairId: "affair_hydrate_non_current",
            title: "带 currentJobId 的事务",
            ownerAgent: "zhang-boss",
            status: "running",
            context: [],
            acceptanceCriteria: ["只看 current job"],
            currentJobId: "job_current_missing",
            blockedReason: null,
            resumeCondition: null,
          }],
          jobs: [{
            jobId: "job_old_completed",
            affairId: "affair_hydrate_non_current",
            executor: "openclaw",
            status: "completed",
            purpose: "execution",
            goal: "旧执行",
            workspaceHint: null,
            allowedPermissions: ["workspace.read"],
            progressSummary: "旧 job 完成",
            blockedReason: null,
            resumeCondition: null,
            permissionRequestId: null,
          }],
          chatMessages: [],
          contextAttachments: [],
          pendingContext: [],
        }),
        save: () => {},
      },
    });

    const snapshot = backend.getSnapshot();
    assert.equal(snapshot.currentAffair?.currentJobId, "job_current_missing");
    assert.equal(snapshot.currentAffair?.status, "running");
    assert.equal(snapshot.currentAffair?.currentJobStatus, null);
  });
});
