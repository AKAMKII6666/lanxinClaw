/**
 * 桌面壳把 bridge action 编成协议出站。
 *
 * 职责：pairing.approve 之外的 chat/resume/decision 出站与打开日志。
 * 不拥有：gate 裁决、OpenClaw 委派细节。
 * 副作用：broadcast、delegator、打开日志目录。
 */

import type { Logger } from "pino";
import type { BridgeActionResult, BridgeUiAction } from "../../bridge/contract.js";
import type { CompanionBackendRuntime } from "../../backend/runtime.js";
import type { JobDelegator } from "../../jobs/delegation/delegator.js";
import { dispatchBridgeProtocolAction } from "../../protocol-server/bridge-actions.js";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";

/**
 * @param input 壳侧依赖
 * @param action UI 动作
 * @param result host 裁决结果
 */
export async function runShellBridgeAction(
  input: {
    desktopDeviceId: string;
    backend: CompanionBackendRuntime;
    getDelegator: () => JobDelegator | null;
    broadcast: (envelope: ProtocolEnvelope) => void;
    approvePairing: ((pairingId: string) => Promise<void>) | null;
    openLogDir: () => void;
    relaunchCompanion?: () => void;
    logger: Logger;
  },
  action: BridgeUiAction,
  result: BridgeActionResult,
): Promise<void> {
  if (action.type === "pairing.approve") {
    await input.approvePairing?.(action.pairingId);
  }
  if (action.type === "companion.restart" && result.ok) {
    input.relaunchCompanion?.();
    return;
  }
  const outbound = {
    getParty: () => {
      const phoneDeviceId = input.backend.getState().connection.phoneDeviceId;
      return phoneDeviceId ? { desktopDeviceId: input.desktopDeviceId, phoneDeviceId } : null;
    },
    isSessionAuthenticated: () => input.backend.getState().connection.sessionAuthenticated,
    hasActiveCall: () => false,
    getAffair: (affairId: string) => input.backend.getState().affairs.get(affairId),
    broadcast: input.broadcast,
    pendingContext: input.backend.getPendingContext(),
  };
  if (action.type === "permission.decide" && result.ok) {
    const request = input.backend.getPermissionGate().getRequest(action.permissionRequestId);
    dispatchBridgeProtocolAction(action, outbound, {
      permissionRequestId: action.permissionRequestId,
      ...(request?.jobId ? { jobId: request.jobId } : {}),
      decision: action.decision,
      decidedAt: new Date().toISOString(),
    });
    const delegator = input.getDelegator();
    if (action.decision === "allow_once" || action.decision === "allow_for_job") {
      await delegator?.handlePermissionGranted(action.permissionRequestId);
    } else {
      const reason =
        action.decision === "require_more_context"
          ? "用户要求更多上下文后再授权"
          : "用户拒绝权限请求";
      delegator?.rejectPermission(action.permissionRequestId, reason);
    }
  } else if (action.type !== "permission.decide") {
    const outboundError = dispatchBridgeProtocolAction(action, outbound);
    if (outboundError) {
      input.logger.warn({ outboundError, action: action.type }, "bridge 出站失败");
    }
  }
  if (action.type === "diagnostics.openLogs") {
    input.openLogDir();
  }
}
