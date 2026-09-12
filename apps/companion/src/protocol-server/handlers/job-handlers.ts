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
  releaseJobCreateClaim,
  tryClaimJobCreate,
} from "../job-create-precheck.js";
import {
  buildJobNeedsPermissionEnvelope,
  buildPermissionRequestEnvelope,
} from "../outbound-envelopes.js";
import type { HandleProtocolSocketMessageInput } from "../router.js";
import { resolveOutboundParty } from "../router-utils.js";
import { replyRequest } from "../request-reply.js";

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
  input = { ...input, request: parsed };
  const capabilityPort = input.options.getOpenClawToolCapabilities
    ? { getOpenClawToolCapabilities: input.options.getOpenClawToolCapabilities }
    : {};
  const precheck = precheckJobCreate(input.options.backend, parsed, capabilityPort);
  if (!precheck.ok) {
    replyRequest(input, { ok: false, error: precheck });
    return;
  }
  if (precheck.duplicate) {
    replyRequest(input, { ok: true, acceptedType: "job.create", duplicate: true });
    return;
  }
  const payload = parsed.payload as unknown as JobPayload;
  const gate = input.options.backend.getPermissionGate();
  if (!tryClaimJobCreate(payload.jobId, input.options.backend, gate)) {
    replyRequest(input, {
      ok: false,
      error: {
        code: "job_create_in_flight",
        message: "同 jobId 正在创建或已有 pending 权限请求",
        retryable: true,
      },
    });
    return;
  }
  try {
  const queued = enqueueJobPermission(input.options, parsed);
  if (!queued.ok) {
    releaseJobCreateClaim(payload.jobId);
    replyRequest(input, { ok: false, error: queued });
    return;
  }
  const prepared = prepareJobCreatePermissionApply(input, parsed, payload, queued.request);
  if (!prepared.ok) {
    gate.clearPendingForJob(payload.jobId);
    releaseJobCreateClaim(payload.jobId);
    replyRequest(input, { ok: false, error: prepared.error });
    return;
  }

  if (prepared.phoneDeviceId !== "unknown") {
    input.sendEnvelope(prepared.needsEnv);
    input.sendEnvelope(prepared.permEnv);
  }

  releaseJobCreateClaim(payload.jobId);
  replyRequest(input, { ok: true, acceptedType: "job.create" });
  } finally { releaseJobCreateClaim(payload.jobId); }
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
  const committed = input.options.backend.applyJobCreation(parsed, [needsEnv, permEnv]);
  if (!committed.ok) return { ok: false, error: committed };
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
  input = { ...input, request: envelope };
  const payload = envelope.payload as unknown as { jobId?: string; affairId?: string };
  const jobId = payload.jobId;
  const affairId = payload.affairId ?? "";
  if (!jobId) {
    replyRequest(input, {
      ok: false,
      error: { code: "job_cancel_invalid", message: "job.cancel 缺少 jobId", retryable: false },
    });
    return;
  }
  const existing = input.options.backend.getState().jobs.get(jobId);
  if (existing && existing.affairId !== affairId) {
    replyRequest(input, { ok: false, error: { code: "job_affair_mismatch", message: "job 不属于目标事务", retryable: false } });
    return;
  }
  if (!existing || isTerminalJobStatus(existing.status)) {
    replyRequest(input, { ok: true, acceptedType: "job.cancel", duplicate: true });
    return;
  }
  input.options.backend.getPermissionGate().revokeForJob(jobId);
  if (!input.options.onJobCancel) {
    replyRequest(input, { ok: false, error: { code: "job_cancel_unavailable", message: "执行器不可用，取消尚未确认", retryable: true } });
    return;
  }
  try {
    await input.options.onJobCancel({ jobId, affairId });
    const status = input.options.backend.getState().jobs.get(jobId)?.status;
    if (!status || !isTerminalJobStatus(status)) throw new Error("子 job 尚未确认停止");
    replyRequest(input, { ok: true, acceptedType: "job.cancel" });
  } catch (error) {
    replyRequest(input, { ok: false, error: {
      code: "job_cancel_unconfirmed", message: error instanceof Error ? error.message : "取消尚未确认", retryable: true,
    } });
  }
}

function isTerminalJobStatus(status: JobPayload["status"]): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}
