/** 真实权限/adapter/delegator 的关闭夹具；替身仅位于 runtime。 */
import { OpenClawAdapter, createMutableMockOpenClawRuntimeClient } from "@lanxin-claw/openclaw-adapter";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { CompanionBackendRuntime } from "../../../src/backend/runtime.js";
import { JobDelegator } from "../../../src/jobs/delegation/delegator.js";

export function createCancelDelegator(backend: CompanionBackendRuntime, sent: ProtocolEnvelope[] = []): JobDelegator {
  return new JobDelegator({
    adapter: new OpenClawAdapter({ runtime: createMutableMockOpenClawRuntimeClient().client }),
    gate: backend.getPermissionGate(), desktopDeviceId: "desktop_cancel_fixture",
    getJob: (id) => backend.getState().jobs.get(id),
    getJobStatus: (id) => backend.getState().jobs.get(id)?.status,
    getPhoneDeviceId: () => "phone_cancel_fixture",
    applyProtocolEnvelope: (envelope) => backend.applyProtocolEnvelope(envelope),
    sendEnvelope: (envelope) => { sent.push(envelope); },
  });
}

export async function cancelThroughCoordinator(backend: CompanionBackendRuntime, affairId: string) {
  const affair = backend.getState().affairs.get(affairId)!;
  const delegator = createCancelDelegator(backend);
  return backend.getAffairActions().execute({ actorId: "phone_cancel_fixture", requestId: `cancel_${affairId}`,
    command: { affairId, status: "canceled", expectedCurrentJobId: affair.currentJobId ?? null },
  }, { desktopDeviceId: "desktop_cancel_fixture", cancelJob: (job) => delegator.cancelJob(job), sendEnvelope: () => {} });
}
