/**
 * 本机低风险只读 runtime 契约：真实执行 list_root / git status。
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  OpenClawAdapter,
  buildLowRiskGoal,
  createLocalSafeRuntimeClient,
  parseLowRiskTaskKind,
  requiredPermissionsForLowRisk,
} from "../../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("low-risk task catalog", () => {
  it("解析白名单 goal；拒绝任意命令伪装", () => {
    assert.equal(parseLowRiskTaskKind(buildLowRiskGoal("git.status", "x")), "git.status");
    assert.equal(parseLowRiskTaskKind("rm -rf /"), null);
    assert.deepEqual(requiredPermissionsForLowRisk("workspace.list_root"), ["workspace.read"]);
  });
});

describe("local-safe runtime 实跑", () => {
  it("workspace.list_root 完成后 job=completed，不暗示 affair", async () => {
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const created = await adapter.createJob({
      jobId: "job_list_root",
      affairId: "affair_list_root",
      goal: buildLowRiskGoal("workspace.list_root", "只读列根目录"),
      workspaceHint: repoRoot,
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal(created.job.status, "completed");
    assert.match(created.job.progressSummary, /list_root count=/);
    assert.ok(created.job.progressSummary.includes("package.json") || created.job.progressSummary.includes("AGENTS.md"));
  });

  it("git.status 只读命令可完成", async () => {
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const created = await adapter.createJob({
      jobId: "job_git_status",
      affairId: "affair_git_status",
      goal: buildLowRiskGoal("git.status", "只读 git status"),
      allowedPermissions: ["git.read"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal(created.job.status, "completed");
    assert.match(created.job.progressSummary, /^git_status:/);
  });

  it("非白名单 goal 失败且不得抬权执行", async () => {
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const created = await adapter.createJob({
      jobId: "job_bad_goal",
      affairId: "affair_bad_goal",
      goal: "curl http://evil.example",
      allowedPermissions: ["network.access"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal(created.job.status, "failed");
    assert.match(created.job.progressSummary, /unsupported_goal/);
  });

  it("workspaceHint 绝对越界与 .. 逃逸必须失败", async () => {
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const outsideAbs = path.resolve(repoRoot, "..");
    const escaped = await adapter.createJob({
      jobId: "job_hint_abs_escape",
      affairId: "affair_hint_abs_escape",
      goal: buildLowRiskGoal("workspace.list_root", "越界绝对路径"),
      workspaceHint: outsideAbs,
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(escaped.ok, true);
    if (!escaped.ok) {
      return;
    }
    assert.equal(escaped.job.status, "failed");
    assert.match(escaped.job.progressSummary, /workspace_out_of_scope/);

    const relativeEscape = await adapter.createJob({
      jobId: "job_hint_rel_escape",
      affairId: "affair_hint_rel_escape",
      goal: buildLowRiskGoal("git.status", "相对路径逃逸"),
      workspaceHint: "../..",
      allowedPermissions: ["git.read"],
    });
    assert.equal(relativeEscape.ok, true);
    if (!relativeEscape.ok) {
      return;
    }
    assert.equal(relativeEscape.job.status, "failed");
    assert.match(relativeEscape.job.progressSummary, /workspace_out_of_scope/);
  });

  it("合法相对/绝对子路径可完成 list_root", async () => {
    const adapter = new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: repoRoot }),
    });
    const byAbs = await adapter.createJob({
      jobId: "job_hint_abs_ok",
      affairId: "affair_hint_abs_ok",
      goal: buildLowRiskGoal("workspace.list_root", "合法绝对根"),
      workspaceHint: repoRoot,
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(byAbs.ok, true);
    if (!byAbs.ok) {
      return;
    }
    assert.equal(byAbs.job.status, "completed");

    const byRel = await adapter.createJob({
      jobId: "job_hint_rel_ok",
      affairId: "affair_hint_rel_ok",
      goal: buildLowRiskGoal("workspace.list_root", "合法相对子路径"),
      workspaceHint: "packages",
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(byRel.ok, true);
    if (!byRel.ok) {
      return;
    }
    assert.equal(byRel.job.status, "completed");
    assert.match(byRel.job.progressSummary, /list_root count=/);
  });
});
