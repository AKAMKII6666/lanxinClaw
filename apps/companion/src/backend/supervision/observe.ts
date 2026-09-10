/** 后端监督装配：采集当前事实、执行监督投影并记录通知指纹；不关闭事务或启动执行器。 */
import type { AffairPayload, JobPayload } from "@lanxin-claw/protocol";
import type { CompanionBackendRuntimeOptions } from "../contracts/runtime.js";
import type { CompanionBackendState } from "../../state/types.js";
import { applyProtocolEnvelopeToState } from "../../state/store.js";
import { applySupervisionActions } from "../../supervision/apply-actions.js";
import { rememberBlockedNotify, runSupervisionTick } from "../../supervision/tick.js";
import type { SupervisionNotifyMemory, SupervisionSnapshot } from "../../supervision/types.js";

export function superviseBackendAffair(state: CompanionBackendState, affair: AffairPayload,
  options: CompanionBackendRuntimeOptions, notifyMemory: SupervisionNotifyMemory): void {
  const job = affair.currentJobId ? state.jobs.get(affair.currentJobId) : undefined;
  const actions = runSupervisionTick(buildSnapshot(affair, job), notifyMemory);
  const party = state.connection.phoneDeviceId
    ? { desktopDeviceId: options.desktopDeviceId ?? "lanxin-desktop", phoneDeviceId: state.connection.phoneDeviceId }
    : null;
  applySupervisionActions(actions, {
    getAffair: (id) => state.affairs.get(id),
    broadcast: (envelope) => {
      if (options.onProtocolBroadcast) { options.onProtocolBroadcast(envelope); return; }
      applyProtocolEnvelopeToState(state, envelope);
    },
    applyOnly: (envelope) => { applyProtocolEnvelopeToState(state, envelope); },
    party, ...(options.onDesktopNotify ? { onDesktopNotify: options.onDesktopNotify } : {}),
  });
  for (const action of actions) {
    if (action.kind === "notify_blocked") rememberBlockedNotify(notifyMemory, action.affairId, action.fingerprint);
  }
}

function buildSnapshot(affair: AffairPayload, job: JobPayload | undefined): SupervisionSnapshot {
  return {
    affairId: affair.affairId, affairTitle: affair.title, affairStatus: affair.status as SupervisionSnapshot["affairStatus"],
    jobId: job?.jobId ?? affair.currentJobId ?? null,
    jobStatus: (job?.status as SupervisionSnapshot["jobStatus"]) ?? null, jobPurpose: job?.purpose ?? "execution",
    progressSummary: job?.progressSummary ?? "", attemptedSteps: [],
    blockedReason: affair.blockedReason ?? job?.blockedReason ?? null,
    resumeCondition: affair.resumeCondition ?? job?.resumeCondition ?? null,
    observedAt: new Date().toISOString(),
  };
}
