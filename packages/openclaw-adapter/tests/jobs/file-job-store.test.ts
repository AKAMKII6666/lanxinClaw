/**
 * Adapter job 文件 store 测试。
 *
 * 职责：验证 jobId → runId 持久化恢复。
 * 不拥有：真实 Gateway、权限裁决、affair 关闭。
 * 副作用：写入临时目录。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createFileAdapterJobStore } from "../../src/index.js";

describe("file adapter job store", () => {
  it("round-trip job mapping without secret fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-job-store-"));
    const file = path.join(dir, "jobs.json");
    const first = createFileAdapterJobStore(file);
    first.set({
      jobId: "job_file_001",
      affairId: "affair_file_001",
      status: "running",
      goal: "persist run mapping",
      workspaceHint: "F:/workspace/demo",
      allowedPermissions: ["workspace.read"],
      openclawRunId: "run_file_001",
      progressSummary: "running",
      blockedReason: null,
      resumeCondition: null,
      lastRunStatus: "running",
    });

    const second = createFileAdapterJobStore(file);
    const loaded = second.get("job_file_001");
    assert.equal(loaded?.openclawRunId, "run_file_001");
    assert.deepEqual(loaded?.allowedPermissions, ["workspace.read"]);
    const raw = fs.readFileSync(file, "utf8");
    assert.equal(raw.includes("token"), false);
    assert.equal(raw.includes("secret"), false);
  });
});
