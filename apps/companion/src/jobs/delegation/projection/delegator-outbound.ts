/**
 * JobDelegator 出站封包辅助。
 *
 * 职责：构造 companion -> phone 的 job/affair envelope 与委派失败投影。
 * 不拥有：轮询、权限裁决、adapter 调用、backend apply/send。
 * 纯函数：无 I/O。
 */

import {
  createEnvelope,
  type AffairPayload,
  type JobStatus,
  type MessageType,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import { toJobPayload } from "../delegator-payload.js";

/** job envelope 可投影字段。 */
export interface DelegatorJobProjection {
  /** job id。 */
  jobId: string;
  /** affair id。 */
  affairId: string;
  /** 目标。 */
  goal: string;
  /** job 用途；exploration 只为澄清上下文，不触发正式验收。 */
  purpose?: "execution" | "exploration";
  /** 工作区提示。 */
  workspaceHint?: string | null;
  /** 已授予权限。 */
  allowedPermissions: readonly string[];
  /** 进度摘要。 */
  progressSummary: string;
  /** 阻塞原因。 */
  blockedReason: string | null;
  /** 恢复条件。 */
  resumeCondition: string | null;
  /** 权限请求 id。 */
  permissionRequestId?: string | null;
  /** 状态理由码。 */
  statusReasonCode?: string | null;
  /** 状态观测时间。 */
  statusObservedAt?: string | null;
}

/** 委派失败时可保留的原 job 上下文。 */
export interface DelegationFailureContext {
  /** 原任务目标。 */
  goal?: string;
  /** 原 job 用途。 */
  purpose?: "execution" | "exploration";
  /** 原工作区提示。 */
  workspaceHint?: string | null;
  /** 原声明权限。 */
  allowedPermissions?: readonly string[];
}

/** envelope 身份字段。 */
export interface DelegatorEnvelopeIdentity {
  /** 桌面设备 id。 */
  desktopDeviceId: string;
  /** 电话设备 id。 */
  phoneDeviceId: string;
}

/**
 * 构造 job 状态 envelope。
 *
 * @param input envelope 字段
 * @returns 协议 envelope
 */
export function buildJobEnvelope(input: {
  identity: DelegatorEnvelopeIdentity;
  type: MessageType;
  status: JobStatus;
  job: DelegatorJobProjection;
}): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: input.identity.desktopDeviceId },
    target: { kind: "phone", deviceId: input.identity.phoneDeviceId },
    type: input.type,
    payload: toJobPayload(input.job, input.status),
  });
}

/**
 * 构造 affair.update envelope。
 *
 * @param identity 设备身份
 * @param affair affair 投影
 * @returns 协议 envelope
 */
export function buildAffairUpdateEnvelope(
  identity: DelegatorEnvelopeIdentity,
  affair: AffairPayload,
): ProtocolEnvelope<AffairPayload> {
  return createEnvelope({
    source: { kind: "companion", deviceId: identity.desktopDeviceId },
    target: { kind: "phone", deviceId: identity.phoneDeviceId },
    type: "affair.update",
    payload: affair,
  });
}

/**
 * 构造委派失败 job 投影。
 *
 * @param jobId job id
 * @param affairId affair id
 * @param message 失败原因
 * @param code 稳定错误码
 * @param context 原 job 上下文
 * @returns job 投影
 */
export function buildDelegationFailureJob(
  jobId: string,
  affairId: string,
  message: string,
  code = "lanxin.delegation_failed",
  context?: DelegationFailureContext,
): DelegatorJobProjection {
  const reason = safeReason(message) || "delegation_failed";
  return {
    jobId,
    affairId,
    goal: safeReason(context?.goal ?? "") || reason,
    purpose: context?.purpose ?? "execution",
    workspaceHint: context?.workspaceHint ?? null,
    allowedPermissions: [...(context?.allowedPermissions ?? [])],
    progressSummary: reason,
    blockedReason: reason,
    resumeCondition: null,
    statusReasonCode: code,
    statusObservedAt: new Date().toISOString(),
  };
}

/**
 * 构造运行时读取失败 job 投影，保留原 job 的关联与权限证据。
 *
 * @param job 最近一次成功读取的 job
 * @param message 失败原因
 * @param code 稳定错误码
 * @returns failed job 投影
 */
export function buildRuntimeReadFailureJob(
  job: DelegatorJobProjection,
  message: string,
  code: string,
): DelegatorJobProjection {
  const reason = safeReason(message) || code.trim() || "runtime_read_failed";
  return {
    ...job,
    progressSummary: reason,
    blockedReason: reason,
    resumeCondition: null,
    statusReasonCode: code.trim() || "runtime_read_failed",
    statusObservedAt: new Date().toISOString(),
  };
}

function safeReason(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .trim()
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer ***")
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .slice(0, 800);
}
