/**
 * 演示脚本：经 companion permission gate 跑通低风险只读任务。
 *
 * 职责：本机验收 V1.2-15（list_root 或 git.status）；打印 job 状态。
 * 不拥有：电话配对、OpenClaw Gateway、affair 用户验收关闭。
 * 副作用：只读列目录 / git status；不写仓库。
 *
 * 用法（仓库根）：npx tsx scripts/low-risk-job/run-readonly-check.ts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenClawAdapter,
  createLocalSafeRuntimeClient,
} from "@lanxin-claw/openclaw-adapter";
import { enqueueLowRiskPermission } from "../../apps/companion/src/jobs/enqueue-low-risk-permission.js";
import { runLowRiskJob } from "../../apps/companion/src/jobs/run-low-risk-job.js";
import { PermissionGate } from "../../apps/companion/src/permissions/gate/permission-gate.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 入口：授权 → 实跑 git.status → 断言 affair 未关闭。
 */
async function main(): Promise<void> {
  const gate = new PermissionGate();
  const adapter = new OpenClawAdapter({
    runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
  });
  const jobId = "job_demo_readonly_001";
  const affairId = "affair_demo_readonly_001";
  const enqueued = enqueueLowRiskPermission(gate, {
    jobId,
    affairId,
    kind: "git.status",
    workspaceRoot: repoRoot,
    permissionRequestId: "perm_demo_readonly_001",
  });
  if (!enqueued.ok) {
    throw new Error(`enqueue failed: ${enqueued.code} ${enqueued.message}`);
  }

  const result = await runLowRiskJob(
    { gate, adapter, affairStatus: "running" },
    {
      jobId,
      affairId,
      kind: "git.status",
      workspaceRoot: repoRoot,
      permissionRequestId: enqueued.permissionRequestId,
      permissionDecision: "allow_for_job",
    },
  );
  if (!result.ok) {
    throw new Error(`run failed: ${result.code} ${result.message}`);
  }
  if (result.job.status !== "completed") {
    throw new Error(`expected job completed, got ${result.job.status}`);
  }
  if (result.affairStatusAfter === "closed") {
    throw new Error("硬约束失败：job completed 不得映射为 affair closed");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        jobId: result.job.jobId,
        jobStatus: result.job.status,
        affairStatusAfter: result.affairStatusAfter,
        summary: result.job.progressSummary,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
