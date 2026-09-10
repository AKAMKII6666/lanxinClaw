/**
 * Adapter 的 job create/read/cancel 契约测试（mock runtime）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GatewayTransportError,
  OpenClawAdapter,
  createMemoryAdapterJobStore,
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
    recentSteps: [],
    resultDigest: null,
    evidenceQuality: "missing",
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
    const next = applyRunSnapshotToJob(
      baseJob("queued"),
      snap("completed", { summary: "目录读取完成：list_root count=4" }),
    );
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

  it("wait ok 但只有 stop/endedAt 时进入 blocked 而不是待验收", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      summary: "stop",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-08-30T09:44:41.631Z",
        wait: {
          status: "ok",
          endedAt: "2026-08-30T09:44:41.631Z",
          stopReason: "stop",
        },
        lifecycle: {
          endedAt: "2026-08-30T09:44:41.631Z",
          terminalPhase: "end",
          terminalReason: "stop",
        },
        toolFindings: [],
        finalReply: {
          text: "stop",
          source: "wait-result",
          confidence: "medium",
        },
        sourceStatuses: ["ok", "completed"],
      },
    });

    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.terminal_without_result");
    assert.match(next.blockedReason ?? "", /没有返回可验收/);
  });

  it("task completed 但没有结果摘要时不作为完成证据", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-08-30T09:45:00.000Z",
        wait: { status: "ok", endedAt: "2026-08-30T09:45:00.000Z" },
        lifecycle: { endedAt: "2026-08-30T09:45:00.000Z", terminalPhase: "end" },
        toolFindings: [],
        task: { status: "completed" },
        sourceStatuses: ["ok", "completed"],
      },
    });

    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.terminal_without_result");
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

  it("browser timeout 进入 failed 而不是 completed", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-08-30T03:00:45.655Z",
        wait: { status: "ok", endedAt: "2026-08-30T03:00:45.655Z" },
        lifecycle: { endedAt: "2026-08-30T03:00:45.655Z", terminalPhase: "end" },
        toolFindings: [
          {
            toolName: "browser.open",
            status: "timed_out",
            summary: "browser failed: timed out",
          },
        ],
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.equal(next.status, "failed");
    assert.equal(next.statusReasonCode, "openclaw.tool_timed_out");
    assert.match(next.blockedReason ?? "", /timed out/);
  });

  it("浏览器/网络任务只有过程型成功工具时不进入 completed", () => {
    const job = {
      ...baseJob("running"),
      goal: "打开浏览器查询尼泊尔泥石流新闻",
      allowedPermissions: ["network.access"],
    };
    const next = applyRunSnapshotToJob(job, {
      runId: "run_apply",
      status: "completed",
      summary: "done",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-08-30T03:05:00.000Z",
        wait: { status: "ok", endedAt: "2026-08-30T03:05:00.000Z" },
        lifecycle: { endedAt: "2026-08-30T03:05:00.000Z", terminalPhase: "end" },
        toolFindings: [
          {
            toolName: "browser.open",
            status: "succeeded",
            summary: "opened blank browser page",
          },
        ],
        finalReply: {
          text: "done",
          source: "wait-result",
          confidence: "medium",
        },
        sourceStatuses: ["ok", "completed"],
      },
    });

    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.terminal_without_result");
  });

  it("高风险任务的成功工具带结果摘要时可以进入 completed", () => {
    const job = {
      ...baseJob("running"),
      goal: "运行测试",
      allowedPermissions: ["command.run"],
    };
    const next = applyRunSnapshotToJob(job, {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-08-30T03:06:00.000Z",
        wait: { status: "ok", endedAt: "2026-08-30T03:06:00.000Z" },
        lifecycle: { endedAt: "2026-08-30T03:06:00.000Z", terminalPhase: "end" },
        toolFindings: [
          {
            toolName: "command.run",
            status: "succeeded",
            summary: "npm test passed with 52 tests",
          },
        ],
        sourceStatuses: ["ok", "completed"],
      },
    });

    assert.equal(next.status, "completed");
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
