/**
 * Job 监督投影与空壳 completed 门闩契约测试。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdapterJobRecord } from "../../src/index.js";
import { applyRunSnapshotToJob } from "../../src/mapping/apply-run-snapshot.js";

/**
 * 构造最小 job 登记。
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

describe("supervise projection / empty completed gate", () => {
  it("tool 低信号 summary + finalReply 含文件清单时 completed 且摘要用清单", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-09-06T02:00:00.000Z",
        wait: { status: "ok", endedAt: "2026-09-06T02:00:00.000Z" },
        lifecycle: { endedAt: "2026-09-06T02:00:00.000Z", terminalPhase: "end" },
        toolFindings: [
          {
            toolName: "workspace.list",
            status: "succeeded",
            summary: "completed",
          },
        ],
        finalReply: {
          text: "桌面文件：A.txt, B.docx",
          source: "history",
          confidence: "medium",
        },
        sourceStatuses: ["ok", "completed"],
      },
    });

    assert.equal(next.status, "completed");
    assert.match(next.progressSummary, /A\.txt/);
    assert.match(next.resultDigest ?? "", /B\.docx/);
    assert.equal(next.evidenceQuality, "present");
    assert.notEqual(next.progressSummary.trim().toLowerCase(), "completed");
    assert.notEqual(next.resultDigest, "completed");
  });

  it("仅有 stop/ok 低信号终态时 blocked + terminal_without_result", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      summary: "ok",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-09-06T02:01:00.000Z",
        wait: { status: "ok", endedAt: "2026-09-06T02:01:00.000Z", stopReason: "ok" },
        lifecycle: {
          endedAt: "2026-09-06T02:01:00.000Z",
          terminalPhase: "end",
          terminalReason: "ok",
        },
        toolFindings: [],
        finalReply: { text: "ok", source: "wait-result", confidence: "medium" },
        sourceStatuses: ["ok", "completed"],
      },
    });

    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.terminal_without_result");
    assert.equal(next.evidenceQuality, "weak");
  });

  it("browser already opened 不得因 read 子串误判为 completed", () => {
    const next = applyRunSnapshotToJob(
      {
        ...baseJob("running"),
        allowedPermissions: ["network.access"],
        goal: "打开浏览器搜索新闻",
      },
      {
        runId: "run_apply",
        status: "completed",
        evidence: {
          runId: "run_apply",
          observedAt: "2026-09-06T02:03:00.000Z",
          wait: { status: "ok", endedAt: "2026-09-06T02:03:00.000Z" },
          lifecycle: { endedAt: "2026-09-06T02:03:00.000Z", terminalPhase: "end" },
          toolFindings: [
            {
              toolName: "browser.open",
              status: "succeeded",
              summary: "browser already opened",
            },
          ],
          finalReply: {
            text: "Navigation ready",
            source: "history",
            confidence: "medium",
          },
          sourceStatuses: ["ok", "completed"],
        },
      },
    );
    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.terminal_without_result");
  });

  it("单词语 passed 不得抬到 evidenceQuality=present", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-09-06T02:04:00.000Z",
        wait: { status: "ok", endedAt: "2026-09-06T02:04:00.000Z" },
        lifecycle: { endedAt: "2026-09-06T02:04:00.000Z", terminalPhase: "end" },
        toolFindings: [{ toolName: "tests", status: "succeeded", summary: "passed" }],
        finalReply: { text: "passed", source: "history", confidence: "medium" },
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.equal(next.status, "blocked");
    assert.notEqual(next.evidenceQuality, "present");
  });

  it("running 有 tool finding 时 recentSteps 非空且 progressSummary 为人话", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "running",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-09-06T02:02:00.000Z",
        wait: { status: "running" },
        toolFindings: [
          {
            toolName: "workspace.list",
            status: "succeeded",
            summary: "listing desktop files",
          },
        ],
        sourceStatuses: ["running"],
      },
    });

    assert.equal(next.status, "running");
    assert.ok((next.recentSteps?.length ?? 0) >= 1);
    assert.match(next.recentSteps[0]?.text ?? "", /workspace\.list|listing desktop/);
    assert.notEqual(next.progressSummary.trim().toLowerCase(), "completed");
    assert.ok(next.progressSummary.length > 0);
  });

  it("completed successfully / 已完成 无实体时不得 completed", () => {
    for (const text of ["completed successfully", "已完成", "执行完毕"]) {
      const next = applyRunSnapshotToJob(baseJob("running"), {
        runId: "run_apply",
        status: "completed",
        evidence: {
          runId: "run_apply",
          observedAt: "2026-09-06T02:05:00.000Z",
          wait: { status: "ok", endedAt: "2026-09-06T02:05:00.000Z" },
          lifecycle: { endedAt: "2026-09-06T02:05:00.000Z", terminalPhase: "end" },
          toolFindings: [],
          finalReply: { text, source: "history", confidence: "medium" },
          sourceStatuses: ["ok", "completed"],
        },
      });
      assert.equal(next.status, "blocked", text);
      assert.equal(next.statusReasonCode, "openclaw.terminal_without_result", text);
    }
  });

  it("git.write 任务无实体结果时不得 completed", () => {
    const job = {
      ...baseJob("running"),
      allowedPermissions: ["git.write"],
      goal: "commit changes",
    };
    const next = applyRunSnapshotToJob(job, {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-09-06T02:06:00.000Z",
        wait: { status: "ok", endedAt: "2026-09-06T02:06:00.000Z" },
        lifecycle: { endedAt: "2026-09-06T02:06:00.000Z", terminalPhase: "end" },
        toolFindings: [{ toolName: "git.commit", status: "succeeded", summary: "committed" }],
        finalReply: { text: "done", source: "history", confidence: "medium" },
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.terminal_without_result");
  });

  it("空壳 completed 可纠为 blocked/terminal_without_result", () => {
    const hollow = {
      ...baseJob("completed"),
      progressSummary: "completed",
      resultDigest: null,
      evidenceQuality: "missing" as const,
      statusReasonCode: "openclaw.run_completed",
    };
    const next = applyRunSnapshotToJob(hollow, {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-09-06T02:07:00.000Z",
        wait: { status: "ok", endedAt: "2026-09-06T02:07:00.000Z", stopReason: "ok" },
        lifecycle: {
          endedAt: "2026-09-06T02:07:00.000Z",
          terminalPhase: "end",
          terminalReason: "ok",
        },
        toolFindings: [],
        finalReply: { text: "ok", source: "wait-result", confidence: "medium" },
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.terminal_without_result");
  });

  it("实机桌面清单无共有N个时仍 completed + present", () => {
    const job = {
      ...baseJob("running"),
      goal: "列出当前用户桌面上所有可见的快捷方式和文件图标名称",
    };
    const digest =
      "这是当前桌面上所有可见的文件和快捷方式名称： **文件夹:** - 新建文件夹 - 禹悦病例 - 资料 - ddu **应用程序和工具:** - 微软语音合成助手 1.5.1 - DiskGenius - monky - SecureCRT_Portable";
    const next = applyRunSnapshotToJob(job, {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-09-06T05:47:50.000Z",
        wait: { status: "ok", endedAt: "2026-09-06T05:47:50.000Z" },
        lifecycle: { endedAt: "2026-09-06T05:47:50.000Z", terminalPhase: "end" },
        toolFindings: [],
        finalReply: { text: digest, source: "history", confidence: "medium" },
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.equal(next.status, "completed");
    assert.equal(next.evidenceQuality, "present");
    assert.match(next.resultDigest ?? "", /文件夹/);
    assert.doesNotMatch(next.progressSummary, /没有返回可验收/);
    assert.notEqual(next.statusReasonCode, "openclaw.terminal_without_result");
  });

  it("present digest 时不得保留没有可验收结果文案", () => {
    const next = applyRunSnapshotToJob(
      {
        ...baseJob("running"),
        goal: "扫描桌面图标",
      },
      {
        runId: "run_apply",
        status: "completed",
        evidence: {
          runId: "run_apply",
          observedAt: "2026-09-06T05:50:00.000Z",
          wait: { status: "ok", endedAt: "2026-09-06T05:50:00.000Z" },
          lifecycle: { endedAt: "2026-09-06T05:50:00.000Z", terminalPhase: "end" },
          toolFindings: [],
          finalReply: {
            text: "桌面上共有 **109** 个可见的快捷方式和文件图标，包括： **文件夹:** - 资料 - ddu",
            source: "history",
            confidence: "medium",
          },
          sourceStatuses: ["ok", "completed"],
        },
      },
    );
    assert.equal(next.status, "completed");
    assert.equal(next.evidenceQuality, "present");
    assert.doesNotMatch(next.progressSummary, /没有返回可验收/);
    assert.equal(next.blockedReason, null);
  });

  it("裸斜杠不得抬到 present", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "completed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-09-06T02:08:00.000Z",
        wait: { status: "ok", endedAt: "2026-09-06T02:08:00.000Z" },
        lifecycle: { endedAt: "2026-09-06T02:08:00.000Z", terminalPhase: "end" },
        toolFindings: [],
        finalReply: { text: "looked at a/b casually", source: "history", confidence: "medium" },
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.notEqual(next.evidenceQuality, "present");
  });
});
