/** 事务关闭结果校验。职责：验证完整事务及子 job 停止证据；不拥有状态提交。纯函数：无 I/O。 */
import type { AffairActionResult } from "../../../messages/result-ack.js";
import type { ValidateResult } from "../../result.js";
import { validationFailed } from "../../../errors/protocol-error.js";
import { validateAffairPayload, validateJobPayload } from "./affair-job.js";

/**
 * 校验 companion 关闭事实；接受结果必须含当前执行 job 的完成证据。
 * @param value 不可信 JSON
 * @returns 合法完整结果或失败
 */
export function validateAffairActionResult(value: unknown): ValidateResult<AffairActionResult> {
  const fail = (): ValidateResult<AffairActionResult> => ({ ok: false, error: validationFailed("关闭结果缺少完整事务或子任务停止证据") });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => key !== "affair" && key !== "jobs")) return fail();
  const affair = validateAffairPayload(result.affair);
  if (!affair.ok || !Array.isArray(result.jobs) || !["closed", "canceled"].includes(affair.value.status)) return fail();
  const jobs = validateStoppedJobs(result.jobs, affair.value.affairId);
  if (!jobs || !hasCurrentJobEvidence(affair.value, jobs)) return fail();
  return { ok: true, value: { affair: affair.value, jobs } };
}

function validateStoppedJobs(rawJobs: unknown[], affairId: string): AffairActionResult["jobs"] | null {
  const jobs: AffairActionResult["jobs"] = [];
  const ids = new Set<string>();
  for (const raw of rawJobs) {
    const job = validateJobPayload(raw);
    if (!job.ok || job.value.affairId !== affairId || ids.has(job.value.jobId) ||
        !["completed", "failed", "canceled"].includes(job.value.status)) return null;
    ids.add(job.value.jobId); jobs.push(job.value);
  }
  return jobs;
}

function hasCurrentJobEvidence(affair: AffairActionResult["affair"], jobs: AffairActionResult["jobs"]): boolean {
  const current = jobs.find((job) => job.jobId === affair.currentJobId);
  if (affair.currentJobId && !current) return false;
  if (affair.status !== "closed") return true;
  if (!current || current.purpose === "exploration") return false;
  return current.status === "completed" && current.evidenceQuality === "present" && !!current.resultDigest?.trim();
}
