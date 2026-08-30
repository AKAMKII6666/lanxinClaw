/**
 * Adapter 的 job create/read/cancel 契约测试（mock runtime）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GatewayTransportError,
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

  it("wait ok 但最终回复显示未完成时进入 blocked 而不是 completed", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        jobId: "job_apply",
        affairId: "affair_apply",
        sessionKey: "lanxing-job:job_apply",
        observedAt: "2026-07-22T00:00:00.000Z",
        wait: { status: "ok", endedAt: "2026-07-22T00:00:00.000Z" },
        lifecycle: { endedAt: "2026-07-22T00:00:00.000Z", terminalPhase: "end" },
        toolFindings: [],
        finalReply: {
          text: "浏览器受策略限制，无法打开新闻页。",
          source: "history",
          confidence: "weak",
        },
        sourceStatuses: ["ok"],
      },
    });
    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.final_reply_negative");
    assert.match(next.blockedReason ?? "", /无法打开/);
  });

  it("wait ok 但 lifecycle error 时进入 failed 而不是 completed", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-07-22T00:00:00.000Z",
        wait: { status: "ok", endedAt: "2026-07-22T00:00:00.000Z" },
        lifecycle: {
          endedAt: "2026-07-22T00:00:00.000Z",
          terminalPhase: "error",
          terminalReason: "browser process crashed",
        },
        toolFindings: [],
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.equal(next.status, "failed");
    assert.equal(next.statusReasonCode, "openclaw.lifecycle_failed");
    assert.match(next.blockedReason ?? "", /browser process crashed/);
  });

  it("非法 evidence observedAt 会被归一为协议可接受时间", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "not-a-date",
        wait: { status: "ok", endedAt: "2026-07-22T00:00:00.000Z" },
        lifecycle: { endedAt: "2026-07-22T00:00:00.000Z", terminalPhase: "end" },
        toolFindings: [],
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.notEqual(next.statusObservedAt, "not-a-date");
    assert.match(next.statusObservedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  });

  it("wait-only timeout 保持 running，terminal timeout 进入 failed", () => {
    const waitOnly = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "running",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-07-22T00:00:00.000Z",
        wait: { status: "timeout", timeoutPhase: "queue" },
        toolFindings: [],
        sourceStatuses: ["timeout"],
      },
    });
    assert.equal(waitOnly.status, "running");
    assert.equal(waitOnly.statusReasonCode, "openclaw.wait_timeout_observing");

    const terminal = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "timed_out",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-07-22T00:01:00.000Z",
        wait: {
          status: "timeout",
          timeoutPhase: "terminal",
          endedAt: "2026-07-22T00:01:00.000Z",
        },
        lifecycle: { endedAt: "2026-07-22T00:01:00.000Z", terminalPhase: "timeout" },
        toolFindings: [],
        sourceStatuses: ["timeout"],
      },
    });
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.statusReasonCode, "openclaw.run_terminal_timeout");
  });

  it("audit/tool 策略阻塞证据优先于 run completed", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-07-22T00:02:00.000Z",
        wait: { status: "ok", endedAt: "2026-07-22T00:02:00.000Z" },
        lifecycle: { endedAt: "2026-07-22T00:02:00.000Z", terminalPhase: "end" },
        toolFindings: [
          {
            toolCallId: "tool_1",
            toolName: "browser.open",
            status: "failed",
            errorCode: "policy_blocked",
            summary: "Browser launch blocked by policy",
          },
        ],
        sourceStatuses: ["ok"],
      },
    });
    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.blocked_by_tool_or_policy");
  });

  it("tool/audit 摘要进入 job 前会脱敏 token", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-07-22T00:03:00.000Z",
        wait: { status: "ok", endedAt: "2026-07-22T00:03:00.000Z" },
        lifecycle: { endedAt: "2026-07-22T00:03:00.000Z", terminalPhase: "end" },
        toolFindings: [
          {
            toolName: "browser.open",
            status: "failed",
            errorCode: "policy_blocked",
            summary: "blocked token=abcdefghijklmnop",
          },
        ],
        sourceStatuses: ["ok"],
      },
    });
    assert.equal(next.status, "blocked");
    assert.match(next.blockedReason ?? "", /token=\*\*\*/);
    assert.equal((next.blockedReason ?? "").includes("abcdefghijklmnop"), false);
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
