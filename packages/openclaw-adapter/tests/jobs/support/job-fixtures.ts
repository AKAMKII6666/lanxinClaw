/** job 测试的基础输入；不包含测试用例。 */
import type { OpenClawRunSnapshot } from "../../../src/client/runtime-client.js";
import {
type AdapterJobRecord
} from "../../../src/index.js";


/**
 * 构造最小 job 登记，供 applyRunSnapshot 单测使用。
 *
 * @param status 初始协议状态
 * @returns 测试用登记
 */
export function baseJob(status: AdapterJobRecord["status"]): AdapterJobRecord {
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
export function snap(
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
