/**
 * Companion 低风险 job：permission gate → local-safe adapter 契约。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  OpenClawAdapter,
  createLocalSafeRuntimeClient,
} from "@lanxin-claw/openclaw-adapter";
import { enqueueLowRiskPermission } from "../../src/jobs/enqueue-low-risk-permission.js";
import { runLowRiskJob } from "../../src/jobs/run-low-risk-job.js";
import { PermissionGate } from "../../src/permissions/gate/permission-gate.js";

/** apps/companion/tests/jobs → 仓库根（四级上溯） */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("companion low-risk job contract", () => {
  it("repoRoot 锚定仓库根（AGENTS.md / package.json）", () => {
    assert.ok(fs.existsSync(path.join(repoRoot, "AGENTS.md")), `missing AGENTS.md under ${repoRoot}`);
    assert.ok(
      fs.existsSync(path.join(repoRoot, "package.json")),
      `missing package.json under ${repoRoot}`,
    );
  });

  it("授权后实跑 git.status；job completed 而 affair 仍为 running", async () => {
    const gate = new PermissionGate();
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const jobId = "job_lr_git_001";
    const affairId = "affair_lr_git_001";
    const enqueued = enqueueLowRiskPermission(gate, {
      jobId,
      affairId,
      kind: "git.status",
      workspaceRoot: repoRoot,
      permissionRequestId: "perm_lr_git_001",
    });
    assert.equal(enqueued.ok, true);
    if (!enqueued.ok) {
      return;
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
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.job.status, "completed");
    assert.equal(result.affairStatusAfter, "running");
    assert.notEqual(result.affairStatusAfter, "closed");
    assert.match(result.job.progressSummary, /^git_status:/);
  });

  it("授权后 list_root 抽样含 AGENTS.md；workspaceRoot 与 proposedScope 一致", async () => {
    const gate = new PermissionGate();
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const enqueued = enqueueLowRiskPermission(gate, {
      jobId: "job_lr_list",
      affairId: "affair_lr_list",
      kind: "workspace.list_root",
      workspaceRoot: repoRoot,
      permissionRequestId: "perm_lr_list",
    });
    assert.equal(enqueued.ok, true);
    if (!enqueued.ok) {
      return;
    }
    const result = await runLowRiskJob(
      { gate, adapter, affairStatus: "running" },
      {
        jobId: "job_lr_list",
        affairId: "affair_lr_list",
        kind: "workspace.list_root",
        workspaceRoot: repoRoot,
        permissionRequestId: enqueued.permissionRequestId,
        permissionDecision: "allow_for_job",
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.job.status, "completed");
    assert.match(result.job.progressSummary, /AGENTS\.md/);
    assert.equal(result.affairStatusAfter, "running");
  });

  it("deny 后不得委派 adapter 执行", async () => {
    const gate = new PermissionGate();
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const enqueued = enqueueLowRiskPermission(gate, {
      jobId: "job_lr_deny",
      affairId: "affair_lr_deny",
      kind: "workspace.list_root",
      permissionRequestId: "perm_lr_deny",
    });
    assert.equal(enqueued.ok, true);
    if (!enqueued.ok) {
      return;
    }
    const result = await runLowRiskJob(
      { gate, adapter, affairStatus: "running" },
      {
        jobId: "job_lr_deny",
        affairId: "affair_lr_deny",
        kind: "workspace.list_root",
        permissionRequestId: enqueued.permissionRequestId,
        permissionDecision: "deny",
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "permission_blocked");
  });

  it("workspaceRoot 超出 proposedScope 时拒绝委派", async () => {
    const gate = new PermissionGate();
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const enqueued = enqueueLowRiskPermission(gate, {
      jobId: "job_lr_scope",
      affairId: "affair_lr_scope",
      kind: "workspace.list_root",
      workspaceRoot: repoRoot,
      permissionRequestId: "perm_lr_scope",
    });
    assert.equal(enqueued.ok, true);
    if (!enqueued.ok) {
      return;
    }
    const result = await runLowRiskJob(
      { gate, adapter, affairStatus: "running" },
      {
        jobId: "job_lr_scope",
        affairId: "affair_lr_scope",
        kind: "workspace.list_root",
        workspaceRoot: path.resolve(repoRoot, ".."),
        permissionRequestId: enqueued.permissionRequestId,
        permissionDecision: "allow_for_job",
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "workspace_scope_mismatch");
  });
});
