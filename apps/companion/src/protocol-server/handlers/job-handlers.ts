/**
 * job.create / job.cancel WS handler。
 *
 * 职责：事务化 job.create、幂等 cancel 门闩。
 * 不拥有：HTTP 监听、OpenClaw 委派。
 * 副作用：写 backend/gate 并经 apply/send 出站。
 */

import { validateMessage, type JobPayload, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import { enqueueJobPermission } from "../job-permission.js";
import {
  precheckJobCreate,
  recordJobCreateAccepted,
  releaseJobCreateClaim,
  tryClaimJobCreate,
} from "../job-create-precheck.js";
import {
  buildJobCanceledEnvelope,
  buildJobNeedsPermissionEnvelope,
  buildPermissionRequestEnvelope,
} from "../outbound-envelopes.js";
import type { HandleProtocolSocketMessageInput } from "../router.js";
import { resolveOutboundParty, sendJson } from "../router-utils.js";

/**
 * 处理 job.create：预检、入队 permission、apply 成功才 ack；
 * 出站 needs_permission / permission.request，等待用户授权后再委派。
 *
 * @param input 入参
 * @param parsed job.create envelope
 */
export async function handleJobCreate(
  input: HandleProtocolSocketMessageInput,
  parsed: ProtocolEnvelope,
): Promise<void> {
  const capabilityPort = input.options.getOpenClawToolCapabilities
    ? { getOpenClawToolCapabilities: input.options.getOpenClawToolCapabilities }
    : {};
  const precheck = precheckJobCreate(input.options.backend, parsed, capabilityPort);
  if (!precheck.ok) {
    sendJson(input.socket, { ok: false, error: precheck });
    return;
  }
  if (precheck.duplicate) {
    sendJson(input.socket, { ok: true, acceptedType: "job.create", duplicate: true });
    return;
  }
  const payload = parsed.payload as unknown as JobPayload;
  const gate = input.options.backend.getPermissionGate();
  if (!tryClaimJobCreate(payload.jobId, input.options.backend, gate)) {
    sendJson(input.socket, {
      ok: false,
      error: {
        code: "job_create_in_flight",
        message: "同 jobId 正在创建或已有 pending 权限请求",
        retryable: true,
      },
    });
    return;
  }
  const queued = enqueueJobPermission(input.options, parsed);
  if (!queued.ok) {
    releaseJobCreateClaim(payload.jobId);
    sendJson(input.socket, { ok: false, error: queued });
    return;
  }
  const prepared = prepareJobCreatePermissionApply(input, parsed, payload, queued.request);
  if (!prepared.ok) {
    gate.clearPendingForJob(payload.jobId);
    releaseJobCreateClaim(payload.jobId);
    sendJson(input.socket, { ok: false, error: prepared.error });
    return;
  }

  if (prepared.phoneDeviceId !== "unknown") {
    input.sendEnvelope(prepared.needsEnv);
    input.sendEnvelope(prepared.permEnv);
  }

  recordJobCreateAccepted(input.options.backend, parsed);
  releaseJobCreateClaim(payload.jobId);
  sendJson(input.socket, { ok: true, acceptedType: "job.create" });
}

/**
 * 校验并 apply needs/perm；失败时由调用方清 claim。
 *
 * @param input 入参
 * @param parsed 原始 envelope
 * @param payload job payload
 * @param queued 已入队权限
 */
function prepareJobCreatePermissionApply(
  input: HandleProtocolSocketMessageInput,
  parsed: ProtocolEnvelope,
  payload: JobPayload,
  request: Parameters<typeof buildPermissionRequestEnvelope>[1],
):
  | {
      ok: true;
      phoneDeviceId: string;
      needsEnv: ProtocolEnvelope;
      permEnv: ProtocolEnvelope;
    }
  | {
      ok: false;
      error: { code: string; message: string; retryable: boolean };
    } {
  const jobPayload: JobPayload = {
    ...payload,
    status: "needs_permission",
    permissionRequestId: request.permissionRequestId,
    progressSummary: "",
  };
  const party = resolveOutboundParty(input) ?? {
    desktopDeviceId: input.options.pairing.desktopDeviceId,
    phoneDeviceId: input.options.backend.getState().connection.phoneDeviceId ?? "unknown",
  };
  const needsEnv = buildJobNeedsPermissionEnvelope(party, jobPayload, parsed.messageId);
  const permEnv = buildPermissionRequestEnvelope(party, request, parsed.messageId);
  const outboundValid = validateJobCreateOutbound(needsEnv, permEnv);
  if (!outboundValid.ok) {
    return { ok: false, error: outboundValid.error };
  }
  const appliedNeeds = input.options.backend.applyProtocolEnvelope(needsEnv);
  if (!appliedNeeds.ok) {
    return { ok: false, error: appliedNeeds };
  }
  const appliedPerm = input.options.backend.applyProtocolEnvelope(permEnv);
  if (!appliedPerm.ok) {
    return { ok: false, error: appliedPerm };
  }
  return { ok: true, phoneDeviceId: party.phoneDeviceId, needsEnv, permEnv };
}

function validateJobCreateOutbound(
  needsEnv: ProtocolEnvelope,
  permEnv: ProtocolEnvelope,
):
  | { ok: true }
  | { ok: false; error: { code: string; message: string; retryable: false } } {
  const needsValid = validateMessage(needsEnv);
  if (!needsValid.ok) {
    return {
      ok: false,
      error: {
        code: "job_create_outbound_invalid",
        message: needsValid.error.message,
        retryable: false,
      },
    };
  }
  const permValid = validateMessage(permEnv);
  if (!permValid.ok) {
    return {
      ok: false,
      error: {
        code: "job_create_outbound_invalid",
        message: permValid.error.message,
        retryable: false,
      },
    };
  }
  return { ok: true };
}

/**
 * 处理 job.cancel：终态/不存在幂等 ack；needs_permission 本地闭环。
 *
 * @param input 入参
 * @param envelope job.cancel 消息
 */
export async function handleJobCancel(
  input: HandleProtocolSocketMessageInput,
  envelope: ProtocolEnvelope,
): Promise<void> {
  const payload = envelope.payload as unknown as { jobId?: string; affairId?: string };
  const jobId = payload.jobId;
  const affairId = payload.affairId ?? "";
  if (!jobId) {
    sendJson(input.socket, {
      ok: false,
      error: { code: "job_cancel_invalid", message: "job.cancel 缺少 jobId", retryable: false },
    });
    return;
  }
  const existing = input.options.backend.getState().jobs.get(jobId);
  if (!existing || isTerminalJobStatus(existing.status)) {
    sendJson(input.socket, { ok: true, acceptedType: "job.cancel", duplicate: true });
    return;
  }
  if (existing.status === "needs_permission") {
    input.options.backend.getPermissionGate().clearPendingForJob(jobId);
    applyJobCanceled(input, existing, envelope.messageId);
    sendJson(input.socket, { ok: true, acceptedType: "job.cancel" });
    return;
  }
  if (input.options.onJobCancel) {
    try {
      await input.options.onJobCancel({ jobId, affairId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "job_cancel_failed";
      sendJson(input.socket, {
        ok: false,
        error: { code: "job_cancel_failed", message, retryable: true },
      });
      return;
    }
    sendJson(input.socket, { ok: true, acceptedType: "job.cancel" });
    return;
  }
  applyJobCanceled(input, existing, envelope.messageId);
  sendJson(input.socket, { ok: true, acceptedType: "job.cancel" });
}

/**
 * @param status job 状态
 * @returns 是否终态
 */
function isTerminalJobStatus(status: JobPayload["status"]): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

/**
 * apply + 可选 broadcast canceled job。
 *
 * @param input 入参
 * @param existing 当前 job
 * @param correlationId 关联 id
 */
function applyJobCanceled(
  input: HandleProtocolSocketMessageInput,
  existing: JobPayload,
  correlationId: string,
): void {
  const canceled: JobPayload = {
    ...existing,
    status: "canceled",
    progressSummary: existing.progressSummary || "canceled_by_phone",
    statusReasonCode: "lanxin.phone_cancel_requested",
    statusObservedAt: new Date().toISOString(),
  };
  const party = resolveOutboundParty(input);
  const envelope = buildJobCanceledEnvelope(
    party ?? {
      desktopDeviceId: input.options.pairing.desktopDeviceId,
      phoneDeviceId: "unknown",
    },
    canceled,
    correlationId,
  );
  if (party) {
    input.broadcast(envelope);
  } else {
    input.options.backend.applyProtocolEnvelope(envelope);
  }
}
