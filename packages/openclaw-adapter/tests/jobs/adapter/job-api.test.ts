/** adapter job 生命周期；从原合同测试按职责拆出，用例与断言保持完整。 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
GatewayTransportError,
OpenClawAdapter,
createMemoryAdapterJobStore,
createMutableMockOpenClawRuntimeClient,
mapOpenClawRunStatusToJobStatus
} from "../../../src/index.js";
import { applyRunSnapshotToJob } from "../../../src/mapping/apply-run-snapshot.js";
import { baseJob, snap } from "../support/job-fixtures.js";

describe("OpenClawAdapter create/read/cancel · adapter job 生命周期", () => {

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


  it("create 写入 canonical openclawSessionKey；legacy store 仍可 cancel", async () => {
    const { client } = createMutableMockOpenClawRuntimeClient();
    const created = await new OpenClawAdapter({ runtime: client }).createJob({
      jobId: "job_canon",
      affairId: "affair_canon",
      goal: "readonly",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal(created.job.openclawSessionKey, "agent:main:lanxing-job:job_canon");

    const store = createMemoryAdapterJobStore();
    store.set({
      ...created.job,
      jobId: "job_legacy_sess",
      openclawSessionKey: "lanxing-job:job_legacy_sess",
      status: "running",
    });
    const canceled = await new OpenClawAdapter({ runtime: client, store }).cancelJob("job_legacy_sess");
    assert.equal(canceled.ok, true);
    if (canceled.ok) {
      assert.equal(canceled.job.status, "canceled");
    }
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


  it("空权限数组时失败且不创建 run", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const bad = await adapter.createJob({
      jobId: "job_empty_permissions",
      affairId: "affair_empty_permissions",
      goal: "x",
      allowedPermissions: [],
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.code, "invalid_permissions");
    }
    const read = await adapter.readJob("job_empty_permissions", { refresh: false });
    assert.equal(read.ok, false);
  });


  it("空字符串权限项时失败", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const bad = await adapter.createJob({
      jobId: "job_blank_permission",
      affairId: "affair_blank_permission",
      goal: "x",
      allowedPermissions: [" "],
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.code, "invalid_permissions");
    }
  });


  it("未知权限 id 时失败", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const bad = await adapter.createJob({
      jobId: "job_unknown_permission",
      affairId: "affair_unknown_permission",
      goal: "x",
      allowedPermissions: ["not.a.real.permission"],
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.code, "invalid_permissions");
    }
  });


  it("保留 runtime 结构化错误码与 retryable", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    runtime.client.createRun = async () => {
      throw new GatewayTransportError(
        "INVALID_REQUEST",
        "missing scope: operator.write Bearer abcdefghijklmnop",
        false,
      );
    };
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const created = await adapter.createJob({
      jobId: "job_structured_error",
      affairId: "affair_structured_error",
      goal: "x",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, false);
    if (!created.ok) {
      assert.equal(created.code, "INVALID_REQUEST");
      assert.equal(created.retryable, false);
      assert.equal(created.message.includes("abcdefghijklmnop"), false);
    }
  });


  it("普通 runtime Error 返回前也会脱敏", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    runtime.client.createRun = async () => {
      throw new Error("network failed token=abcdefghijklmnop");
    };
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const created = await adapter.createJob({
      jobId: "job_plain_error_redaction",
      affairId: "affair_plain_error_redaction",
      goal: "x",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, false);
    if (!created.ok) {
      assert.equal(created.code, "runtime_create_failed");
      assert.match(created.message, /token=\*\*\*/);
      assert.equal(created.message.includes("abcdefghijklmnop"), false);
    }
  });


  it("readJob 拒绝不属于当前 job 的 run 快照", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const created = await adapter.createJob({
      jobId: "job_identity",
      affairId: "affair_identity",
      goal: "x",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    const originalRunId = created.job.openclawRunId;
    runtime.client.getRun = async () => ({
      runId: "run_from_other_job",
      status: "completed",
      summary: "wrong run",
    });

    const read = await adapter.readJob("job_identity");

    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.code, "runtime_evidence_mismatch");
    }
    const cached = await adapter.readJob("job_identity", { refresh: false });
    assert.equal(cached.ok, true);
    if (cached.ok) {
      assert.equal(cached.job.status, "running");
      assert.equal(cached.job.openclawRunId, originalRunId);
    }
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
      patch: { summary: "只读检查已完成：list_root count=3" },
    });
    const read = await adapter.readJob("job_done");
    assert.equal(read.ok, true);
    if (!read.ok) {
      return;
    }
    assert.equal(read.job.status, "completed");
  });


  it("成功摘要提到 permission grant 时不得误判为 final negative", async () => {
    const { client, advance } = createMutableMockOpenClawRuntimeClient();
    const adapter = new OpenClawAdapter({ runtime: client });
    const created = await adapter.createJob({
      jobId: "job_permission_granted_done",
      affairId: "affair_permission_granted_done",
      goal: "只读检查授权后的执行结果",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    advance({
      runId: created.job.openclawRunId!,
      status: "completed",
      patch: { summary: "adapter mock completed after permission grant: listed 2 files" },
    });
    const read = await adapter.readJob("job_permission_granted_done");
    assert.equal(read.ok, true);
    if (!read.ok) {
      return;
    }
    assert.equal(read.job.status, "completed");
  });
});
