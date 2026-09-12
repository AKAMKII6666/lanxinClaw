/** 关闭动作的当前事实校验；不读取客户端快照，也不产生副作用。 */
import { canTransitionAffairStatus, type AffairClosePayload, type AffairPayload, type JobPayload, type ProtocolError } from "@lanxin-claw/protocol";
import type { CompanionBackendState } from "../../../state/types.js";

/** 返回可直接回执的明确业务拒绝；null 表示可进入执行阶段。 */
export function precheckAffairClose(state: CompanionBackendState, command: AffairClosePayload): ProtocolError | null {

  const affair = state.affairs.get(command.affairId);
  if (!affair) return fail("affair_not_found", "找不到对应事务");
  if ((affair.currentJobId ?? null) !== command.expectedCurrentJobId) {
    return fail("affair_current_job_changed", "当前 job 已变化，请刷新事务后重新确认");
  }
  if (affair.status === "closed" || affair.status === "canceled" || !canTransitionAffairStatus(affair.status, command.status)) {
    return fail("affair_close_rejected", "事务当前状态不允许该关闭操作");
  }
  if (command.status === "canceled") return null;
  return precheckAcceptance(state, affair, command);
}

function precheckAcceptance(state: CompanionBackendState, affair: AffairPayload, command: AffairClosePayload): ProtocolError | null {
  const job = affair.currentJobId ? state.jobs.get(affair.currentJobId) : null;
  if (affair.status !== "waiting_acceptance" || !command.acceptanceSummary?.trim() ||
      !hasAcceptanceEvidence(job, affair.affairId)) {
    return fail("affair_acceptance_evidence_missing", "当前执行 job 尚无可验收的完整结果");
  }
  if ([...state.jobs.values()].some((item) => item.affairId === affair.affairId && !isTerminalJob(item.status))) {
    return fail("affair_jobs_still_active", "事务仍有可能执行的 job，不能验收关闭");
  }
  return null;
}

/** blocked 仍可能恢复执行，不是取消证据。 */
export function isTerminalJob(status: string): boolean {
  return ["completed", "failed", "canceled"].includes(status);
}

function hasAcceptanceEvidence(job: JobPayload | null | undefined, affairId: string): boolean {
  if (!job || job.affairId !== affairId) return false;
  return job.status === "completed" && job.purpose !== "exploration" &&
    job.evidenceQuality === "present" && !!job.resultDigest?.trim();
}

function fail(code: string, message: string): ProtocolError { return { code, message, retryable: false }; }
