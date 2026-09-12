/**
 * 查资料旁路证据与 browser-first 委派契约测试。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OpenClawAdapter,
  createMutableMockOpenClawRuntimeClient,
  type AdapterJobRecord,
} from "../../src/index.js";
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

describe("web research evidence bypass", () => {
  it("web_search disabled/no provider 终态进入 blocked（web_search_disabled）而不是 completed", () => {
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
            toolName: "web_search",
            status: "failed",
            summary: "web_search failed: web_search is disabled or no provider is available",
          },
        ],
        sourceStatuses: ["ok", "completed"],
      },
    });
    assert.equal(next.status, "blocked");
    assert.equal(next.statusReasonCode, "openclaw.web_search_disabled");
    assert.match(next.blockedReason ?? "", /no provider|disabled/);
  });

  it("仅 web_search disabled 且 run 仍在进行时不秒杀为 failed", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "running",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-08-30T03:00:45.655Z",
        wait: { status: "pending" },
        toolFindings: [
          {
            toolName: "web_search",
            status: "failed",
            summary: "web_search is disabled or no provider is available",
          },
        ],
        sourceStatuses: ["running"],
      },
    });
    assert.equal(next.status, "running");
    assert.notEqual(next.statusReasonCode, "openclaw.tool_failed");
  });

  it("过早 web_fetch 失败且尚无 browser 时不秒杀为 failed", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "running",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-08-30T03:00:45.655Z",
        wait: { status: "pending" },
        toolFindings: [
          {
            toolName: "web_fetch",
            status: "failed",
            summary: "fetch failed",
          },
        ],
        sourceStatuses: ["running"],
      },
    });
    assert.equal(next.status, "running");
    assert.notEqual(next.statusReasonCode, "openclaw.web_fetch_failed");
    assert.notEqual(next.statusReasonCode, "openclaw.tool_failed");
  });

  it("终态 web_fetch 失败可映射 web_fetch_failed", () => {
    const next = applyRunSnapshotToJob(baseJob("running"), {
      runId: "run_apply",
      status: "failed",
      evidence: {
        runId: "run_apply",
        observedAt: "2026-08-30T03:00:45.655Z",
        wait: { status: "error", endedAt: "2026-08-30T03:00:45.655Z" },
        lifecycle: { endedAt: "2026-08-30T03:00:45.655Z", terminalPhase: "end" },
        toolFindings: [
          {
            toolName: "web_fetch",
            status: "failed",
            summary: "fetch failed",
          },
        ],
        sourceStatuses: ["failed"],
      },
    });
    assert.equal(next.status, "failed");
    assert.equal(next.statusReasonCode, "openclaw.web_fetch_failed");
  });
});

describe("browser-first createRun message", () => {
  it("查资料 goal 委派 message 含 browser-first 前缀且保留原 goal", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    let capturedInput = "";
    const original = runtime.client.createRun.bind(runtime.client);
    runtime.client.createRun = async (params) => {
      capturedInput = params.input;
      return original(params);
    };
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const goal = "查询BNB当前价格";
    const created = await adapter.createJob({
      jobId: "job_browser_first",
      affairId: "affair_browser_first",
      goal,
      allowedPermissions: ["network.access", "desktop.control"],
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.match(capturedInput, /优先使用 browser/);
    assert.match(capturedInput, /不要调用 web_search/);
    assert.match(capturedInput, new RegExp(goal));
    assert.equal(created.job.goal, goal);
  });

  it("本地读盘 goal 不附加 browser-first 前缀", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    let capturedInput = "";
    const original = runtime.client.createRun.bind(runtime.client);
    runtime.client.createRun = async (params) => {
      capturedInput = params.input;
      return original(params);
    };
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const goal = "列出仓库根目录（只读）";
    const created = await adapter.createJob({
      jobId: "job_local_only",
      affairId: "affair_local_only",
      goal,
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    assert.equal(capturedInput, goal);
  });

  it("含「查询」的本地 goal 不因宽匹配被包装", async () => {
    const runtime = createMutableMockOpenClawRuntimeClient();
    let capturedInput = "";
    const original = runtime.client.createRun.bind(runtime.client);
    runtime.client.createRun = async (params) => {
      capturedInput = params.input;
      return original(params);
    };
    const adapter = new OpenClawAdapter({ runtime: runtime.client });
    const goal = "查询仓库内 README 内容";
    const created = await adapter.createJob({
      jobId: "job_local_query",
      affairId: "affair_local_query",
      goal,
      allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    assert.equal(capturedInput, goal);
  });
});