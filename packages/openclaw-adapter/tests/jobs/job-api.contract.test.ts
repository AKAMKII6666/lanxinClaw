/**
 * Adapter 的 job create/read/cancel 契约测试（mock runtime）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OpenClawAdapter,
  createMutableMockOpenClawRuntimeClient,
  mapOpenClawRunStatusToJobStatus,
  type AdapterJobRecord,
} from "../../src/index.js";
import { applyRunSnapshotToJob } from "../../src/mapping/apply-run-snapshot.js";
import type { OpenClawRunSnapshot } from "../../src/client/runtime-client.js";

/**
 * 构造最小 job 登记，供 applyRunSnapshot 单测使用。
 *
 * @param status 初始协议状态
 * @returns 测试用登记
 */
function baseJob(status: AdapterJobRecord["status"]): AdapterJobRecord {
  return {
    jobId: "job_apply",
    affairId: "affair_apply",
    status,
    goal: "probe",
    workspaceHint: null,
    allowedPermissions: ["workspace.read"],
    openclawRunId: "run_apply",
    progressSummary: "",
    blockedReason: null,
    resumeCondition: null,
    lastRunStatus: null,
  };
}

/**
 * @param status runtime 状态
 * @param patch 可选摘要字段
 * @returns 快照
 */
function snap(
  status: OpenClawRunSnapshot["status"],
  patch?: Partial<OpenClawRunSnapshot>,
): OpenClawRunSnapshot {
  return {
    runId: "run_apply",
    status,
    summary: patch?.summary,
    blockedReason: patch?.blockedReason ?? null,
    resumeCondition: patch?.resumeCondition ?? null,
  };
}

describe("mapOpenClawRunStatusToJobStatus", () => {
  it("覆盖核心映射且 completed 不暗示 affair closed", () => {
    assert.equal(mapOpenClawRunStatusToJobStatus("accepted"), "running");
    assert.equal(mapOpenClawRunStatusToJobStatus("running"), "running");
    assert.equal(mapOpenClawRunStatusToJobStatus("waiting_approval"), "needs_permission");
    assert.equal(mapOpenClawRunStatusToJobStatus("blocked"), "blocked");
    assert.equal(mapOpenClawRunStatusToJobStatus("completed"), "completed");
    assert.equal(mapOpenClawRunStatusToJobStatus("failed"), "failed");
    assert.equal(mapOpenClawRunStatusToJobStatus("timed_out"), "failed");
    assert.equal(mapOpenClawRunStatusToJobStatus("cancelled"), "canceled");
  });
});

describe("applyRunSnapshotToJob 遵守 canTransitionJobStatus", () => {
  it("queued→completed 经合法路径可到达 completed", () => {
    const next = applyRunSnapshotToJob(baseJob("queued"), snap("completed", { summary: "ok" }));
    assert.equal(next.status, "completed");
  });

  it("running 收到 accepted 仍保持 running", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), snap("accepted"));
    assert.equal(next.status, "running");
  });

  it("终态 completed 不被非终态 running 覆盖", () => {
    const next = applyRunSnapshotToJob(baseJob("completed"), snap("running", { summary: "stale" }));
    assert.equal(next.status, "completed");
  });

  it("queued→canceled 为直接合法边", () => {
    const next = applyRunSnapshotToJob(baseJob("queued"), snap("cancelled"));
    assert.equal(next.status, "canceled");
  });

  it("needs_permission 收到 accepted 后恢复 running", () => {
    const next = applyRunSnapshotToJob(baseJob("needs_permission"), snap("accepted"));
    assert.equal(next.status, "running");
  });

  it("blocked 收到 accepted 后恢复 running", () => {
    const next = applyRunSnapshotToJob(baseJob("blocked"), snap("accepted"));
    assert.equal(next.status, "running");
  });
});

describe("OpenClawAdapter create/read/cancel", () => {
  it("create → read → cancel 闭环，终态幂等", async () => {
    const { client, advance } = createMutableMockOpenClawRuntimeClient();
    const adapter = new OpenClawAdapter({ runtime: client });

    const created = await adapter.createJob({
      jobId: "job_test_1",
      affairId: "affair_test_1",
      goal: "列出仓库根目录（只读）",
      workspaceHint: null,
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal(created.job.status, "running");
    assert.ok(created.job.openclawRunId);

    advance({
      runId: created.job.openclawRunId!,
      status: "running",
      patch: { summary: "scanning" },
    });
    const running = await adapter.readJob("job_test_1");
    assert.equal(running.ok, true);
    if (!running.ok) {
      return;
    }
    assert.equal(running.job.status, "running");
    assert.equal(running.job.progressSummary, "scanning");

    const canceled = await adapter.cancelJob("job_test_1");
    assert.equal(canceled.ok, true);
    if (!canceled.ok) {
      return;
    }
    assert.equal(canceled.job.status, "canceled");

    const again = await adapter.cancelJob("job_test_1");
    assert.equal(again.ok, true);
    if (!again.ok) {
      return;
    }
    assert.equal(again.job.status, "canceled");
  });

  it("同 jobId 幂等；冲突 goal 拒绝", async () => {
    const adapter = new OpenClawAdapter({
      runtime: createMutableMockOpenClawRuntimeClient().client,
    });
    const input = {
      jobId: "job_idem",
      affairId: "affair_idem",
      goal: "git status",
      allowedPermissions: ["git.read"] as const,
    };
    const first = await adapter.createJob({ ...input });
    assert.equal(first.ok, true);
    const second = await adapter.createJob({ ...input });
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(first.job.openclawRunId, second.job.openclawRunId);
    }
    const conflict = await adapter.createJob({
      ...input,
      goal: "不同目标",
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) {
      assert.equal(conflict.code, "job_id_conflict");
    }
  });

  it("缺少显式权限数组时失败", async () => {
    const adapter = new OpenClawAdapter({
      runtime: createMutableMockOpenClawRuntimeClient().client,
    });
    const bad = await adapter.createJob({
      jobId: "job_bad",
      affairId: "affair_bad",
      goal: "x",
      allowedPermissions: null as unknown as string[],
    });
    assert.equal(bad.ok, false);
  });

  it("completed 刷新后仍只反映 job 完成（先经 running）", async () => {
    const { client, advance } = createMutableMockOpenClawRuntimeClient();
    const adapter = new OpenClawAdapter({ runtime: client });
    const created = await adapter.createJob({
      jobId: "job_done",
      affairId: "affair_done",
      goal: "只读检查",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    advance({
      runId: created.job.openclawRunId!,
      status: "running",
      patch: { summary: "working" },
    });
    const running = await adapter.readJob("job_done");
    assert.equal(running.ok, true);
    if (!running.ok) {
      return;
    }
    assert.equal(running.job.status, "running");

    advance({
      runId: created.job.openclawRunId!,
      status: "completed",
      patch: { summary: "ok" },
    });
    const read = await adapter.readJob("job_done");
    assert.equal(read.ok, true);
    if (!read.ok) {
      return;
    }
    assert.equal(read.job.status, "completed");
  });
});
