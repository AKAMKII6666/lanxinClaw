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
mapOpenClawRunStatusToJobStatus
} from "../../src/index.js";
import { applyRunSnapshotToJob } from "../../src/mapping/apply-run-snapshot.js";

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

import { baseJob, snap } from "./support/job-fixtures.js";
