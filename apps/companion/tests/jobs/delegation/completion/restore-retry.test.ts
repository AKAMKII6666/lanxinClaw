/** 重启恢复遇到暂时读取故障时保留轮询，不能静默遗失既有 run。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness, waitFor } from "../support/harness.js";

test("恢复首次读取失败后继续跟踪，恢复连接后收取原 run 结果", async () => {
  const h = createHarness();
  let creates = 0;
  const create = h.runtime.client.createRun;
  h.runtime.client.createRun = async (input) => { creates += 1; return create(input); };
  const created = await h.adapter.createJob({ jobId: "job_restore_retry", affairId: "affair_test_001",
    goal: "检查目录文件", allowedPermissions: ["workspace.read"] });
  assert.ok(created.ok);
  h.jobStatuses.set(created.job.jobId, "running");
  h.affairCurrentJobIds.set("affair_test_001", created.job.jobId);
  let reads = 0;
  h.runtime.client.getRun = async (runId) => {
    reads += 1;
    if (reads === 1) throw Object.assign(new Error("temporary offline"), { code: "gateway_offline", retryable: true });
    return { runId, status: "completed", summary: "目录检查完成：a.txt 与 b.txt 均存在，未修改文件。" };
  };
  try {
    await h.delegator.restoreInFlightPolling([created.job.jobId]);
    assert.equal(h.delegator.activeJobCount(), 1);
    assert.equal(h.jobStatuses.get(created.job.jobId), "running");
    await waitFor(() => h.jobStatuses.get(created.job.jobId) === "completed");
    assert.equal(h.delegator.activeJobCount(), 0);
    assert.equal(creates, 1);
  } finally { h.delegator.stop(); }
});
