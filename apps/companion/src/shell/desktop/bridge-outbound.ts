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
import type { ApplyProtocolResult } from "../../state/types.js";
import { dispatchBridgeProtocolAction } from "../../protocol-server/bridge-actions.js";
import { buildJobCanceledEnvelope } from "../../protocol-server/outbound-envelopes.js";
import type { JobPayload, ProtocolEnvelope } from "@lanxin-claw/protocol";

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
    broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult | void;
    approvePairing: ((pairingId: string) => Promise<void>) | null;
    openLogDir: () => void;
    relaunchCompanion?: () => void;
    setBrowserProxy?: (
      enabled: boolean,
      url: string,
    ) => Promise<{ ok: true } | { ok: false; code: string; message: string }>;
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
  if (action.type === "settings.setBrowserProxy") {
    if (!input.setBrowserProxy) {
      markBridgeResultFailed(result, "browser_proxy_unavailable", "当前壳未接入浏览器代理设置", false);
      return;
    }
    const applied = await input.setBrowserProxy(action.enabled, action.url);
    if (!applied.ok) {
      markBridgeResultFailed(result, applied.code, applied.message, false);
      return;
    }
    return;
  }
  const outbound = {
    getParty: () => {
      const phoneDeviceId = input.backend.getState().connection.phoneDeviceId;
      return phoneDeviceId ? { desktopDeviceId: input.desktopDeviceId, phoneDeviceId } : null;
    },
    isSessionAuthenticated: () => input.backend.getState().connection.sessionAuthenticated,
    // 通话真源在电话侧；companion 不再用本字段拦截 active_call 出站
    hasActiveCall: () => false,
    getAffair: (affairId: string) => input.backend.getState().affairs.get(affairId),
    broadcast: input.broadcast,
    pendingContext: input.backend.getPendingContext(),
  };
  if (action.type === "permission.decide" && result.ok) {
    const request = input.backend.getPermissionGate().getRequest(action.permissionRequestId);
    const outboundResult = dispatchBridgeProtocolAction(action, outbound, {
      permissionRequestId: action.permissionRequestId,
      ...(request?.jobId ? { jobId: request.jobId } : {}),
      decision: action.decision,
      decidedAt: new Date().toISOString(),
    });
    if (outboundResult.delivery) {
      result.delivery = outboundResult.delivery;
    }
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
  } else if (action.type !== "permission.decide" && result.ok) {
    if (action.type === "affair.cancel" && result.ok) {
      const canceled = await cancelCurrentJobIfNeeded(input, action.affairId);
      if (!canceled.ok) {
        markBridgeResultFailed(result, canceled.code, canceled.message, canceled.retryable);
        return;
      }
    }
    const outboundResult = dispatchBridgeProtocolAction(action, outbound);
    if (outboundResult.delivery) {
      result.delivery = outboundResult.delivery;
    }
    if (outboundResult.error) {
      input.logger.warn({ outboundError: outboundResult.error, action: action.type }, "bridge 出站失败");
    }
  }
  if (action.type === "diagnostics.openLogs") {
    input.openLogDir();
  }
}

async function cancelCurrentJobIfNeeded(
  input: {
    desktopDeviceId: string;
    backend: CompanionBackendRuntime;
    getDelegator: () => JobDelegator | null;
    broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult | void;
    logger: Logger;
  },
  affairId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string; retryable: boolean }> {
  const affair = input.backend.getState().affairs.get(affairId);
  const job = affair?.currentJobId ? input.backend.getState().jobs.get(affair.currentJobId) : null;
  if (!job || job.status === "completed" || job.status === "failed" || job.status === "canceled") {
    return { ok: true };
  }
  if (job.status === "needs_permission") {
    input.backend.getPermissionGate().expirePendingForJob(job.jobId);
    return broadcastNeedsPermissionJobCanceled(input, job, affairId);
  }
  if (!input.getDelegator()) {
    return {
      ok: false,
      code: "job_cancel_unavailable",
      message: "当前执行器不可用，不能确认 job 已取消",
      retryable: true,
    };
  }
  try {
    await input.getDelegator()?.cancelJob({ jobId: job.jobId, affairId });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    input.logger.warn(
      {
        affairId,
        jobId: job.jobId,
        error: message,
      },
      "事务取消时 adapter job 取消失败",
    );
    return {
      ok: false,
      code: "job_cancel_failed",
      message: `取消当前 job 失败：${message}`,
      retryable: true,
    };
  }
}

function broadcastNeedsPermissionJobCanceled(
  input: {
    desktopDeviceId: string;
    backend: CompanionBackendRuntime;
    broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult | void;
    logger: Logger;
  },
  job: JobPayload,
  affairId: string,
): { ok: true } | { ok: false; code: string; message: string; retryable: boolean } {
  const phoneDeviceId = input.backend.getState().connection.phoneDeviceId;
  const canceled: JobPayload = {
    ...job,
    status: "canceled",
    progressSummary: job.progressSummary || "canceled_by_affair",
    blockedReason: null,
    resumeCondition: null,
    statusReasonCode: "lanxin.affair_canceled",
    statusObservedAt: new Date().toISOString(),
  };
  const envelope = buildJobCanceledEnvelope(
    {
      desktopDeviceId: input.desktopDeviceId,
      phoneDeviceId: phoneDeviceId ?? "unknown",
    },
    canceled,
  );
  if (!phoneDeviceId) {
    const applied = input.backend.applyProtocolEnvelope(envelope);
    return applied.ok
      ? { ok: true }
      : { ok: false, code: applied.code, message: applied.message, retryable: applied.retryable };
  }
  const applied = input.broadcast(envelope);
  if (applied && !applied.ok) {
    return { ok: false, code: applied.code, message: applied.message, retryable: applied.retryable };
  }
  input.logger.info({ affairId, jobId: job.jobId }, "事务取消时 needs_permission job 已本地取消");
  return { ok: true };
}

function markBridgeResultFailed(
  result: BridgeActionResult,
  code: string,
  message: string,
  retryable: boolean,
): void {
  Object.assign(result, {
    ok: false,
    error: { code, message, retryable },
  });
}
