/** 本地 UI 关闭操作接入共同事务权威，不经旧出站快照覆盖状态。 */
import { randomUUID } from "node:crypto";
import type { CompanionBackendRuntime } from "../../backend/runtime.js";
import type { BridgeActionResult, BridgeUiAction } from "../../bridge/contract.js";
import type { JobDelegator } from "../../jobs/delegation/delegator.js";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";

/** 成功仅在共同协调器已经持久化关闭结果后返回。 */
export async function runShellAffairClose(input: {
  backend: CompanionBackendRuntime;
  desktopDeviceId: string;
  getDelegator: () => JobDelegator | null;
  sendEnvelope: (envelope: ProtocolEnvelope) => void;
}, action: Extract<BridgeUiAction, { type: "affair.cancel" | "affair.accept" }>, result: BridgeActionResult): Promise<void> {
  const coordinator = input.backend.getAffairActions();
  const actorId = input.desktopDeviceId;
  const pending = coordinator.findPending(action.affairId);
  const affair = input.backend.getState().affairs.get(action.affairId);
  const status: "closed" | "canceled" = action.type === "affair.accept" ? "closed" : "canceled";
  const request = pending?.command.status === status ? pending : {
    requestId: randomUUID(), actorId,
    command: {
      affairId: action.affairId, status,
      expectedCurrentJobId: action.type === "affair.accept" ? action.expectedCurrentJobId : affair?.currentJobId ?? null,
      ...(action.type === "affair.accept" ? { acceptanceSummary: action.acceptanceSummary } : { closeReason: "桌面用户取消事务" }),
    },
  };
  const outcome = await coordinator.execute(request, {
    desktopDeviceId: input.desktopDeviceId,
    cancelJob: async (job) => {
      const delegator = input.getDelegator();
      if (!delegator) throw new Error("执行器不可用，取消尚未确认");
      await delegator.cancelJob(job);
    },
    sendEnvelope: input.sendEnvelope,
  });
  if (!outcome.ok) Object.assign(result, { ok: false, error: outcome.error });
}
