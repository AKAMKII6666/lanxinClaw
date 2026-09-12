/**
 * companion → phone 出站 envelope 构造。
 *
 * 职责：把 gate 请求、UI 意图编成已校验协议 envelope。
 * 不拥有：WS 发送、权限裁决权威、OpenClaw。
 * 纯函数：只构造对象，不发网。
 */

import {
  createEnvelope,
  type AffairPayload,
  type AffairActionResult,
  type ChatContextAttachPayload,
  type ChatMessagePayload,
  type JobPayload,
  type PermissionDecisionPayload,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import type { GatePermissionRequest } from "../permissions/gate/types.js";

/**
 * 出站寻址。
 */
export interface OutboundParty {
  /** 桌面设备 id */
  desktopDeviceId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
}

/**
 * 由 gate 请求构造 permission.request。
 *
 * @param party 寻址
 * @param request gate 请求
 * @param correlationId 可选关联 job.create
 * @returns envelope
 */
export function buildPermissionRequestEnvelope(
  party: OutboundParty,
  request: GatePermissionRequest,
  correlationId?: string,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "permission.request",
    ...(correlationId ? { correlationId } : {}),
    payload: {
      permissionRequestId: request.permissionRequestId,
      jobId: request.jobId,
      affairId: request.affairId,
      requestedPermissions: [...request.requestedPermissions],
      reason: request.reason,
      risk: request.risk,
      proposedScope: { ...request.proposedScope },
    },
  });
}

/**
 * 构造 permission.decision。
 *
 * @param party 寻址
 * @param payload 决策载荷
 * @returns envelope
 */
export function buildPermissionDecisionEnvelope(
  party: OutboundParty,
  payload: PermissionDecisionPayload,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "permission.decision",
    payload,
  });
}

/**
 * 构造 chat.message。
 *
 * @param party 寻址
 * @param payload 消息载荷
 * @returns envelope
 */
export function buildChatMessageEnvelope(
  party: OutboundParty,
  payload: ChatMessagePayload,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "chat.message",
    payload,
  });
}

/**
 * 构造 chat.context_attach。
 *
 * @param party 寻址
 * @param payload 附加载荷
 * @returns envelope
 */
export function buildContextAttachEnvelope(
  party: OutboundParty,
  payload: ChatContextAttachPayload,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "chat.context_attach",
    payload,
  });
}

/**
 * 构造 affair.resume（payload 必须是可迁移后的 affair 对象）。
 *
 * @param party 寻址
 * @param payload 事务载荷
 * @returns envelope
 */
export function buildAffairResumeEnvelope(
  party: OutboundParty,
  payload: AffairPayload,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "affair.resume",
    payload,
  });
}

/**
 * 构造 affair.close（payload 必须是 close/cancel 后的 affair 对象）。
 *
 * @param party 寻址
 * @param payload 事务载荷
 * @returns envelope
 */
export function buildAffairCloseEnvelope(
  party: OutboundParty,
  payload: AffairActionResult,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "affair.close",
    payload,
  });
}

/**
 * 构造 job.needs_permission。
 *
 * @param party 寻址
 * @param payload job 载荷（status=needs_permission）
 * @param correlationId 关联 job.create messageId
 * @returns envelope
 */
export function buildJobNeedsPermissionEnvelope(
  party: OutboundParty,
  payload: JobPayload,
  correlationId?: string,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "job.needs_permission",
    ...(correlationId ? { correlationId } : {}),
    payload,
  });
}

/**
 * 构造 job.progress（含 status 更新）。
 *
 * @param party 寻址
 * @param payload job 载荷
 * @param correlationId 可选关联
 * @returns envelope
 */
export function buildJobProgressEnvelope(
  party: OutboundParty,
  payload: JobPayload,
  correlationId?: string,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "job.progress",
    ...(correlationId ? { correlationId } : {}),
    payload,
  });
}

/**
 * 构造 job.failed。
 *
 * @param party 寻址
 * @param payload job 载荷（status=failed）
 * @returns envelope
 */
export function buildJobFailedEnvelope(
  party: OutboundParty,
  payload: JobPayload,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "job.failed",
    payload,
  });
}

/**
 * 构造 job.canceled。
 *
 * @param party 寻址
 * @param payload job 载荷（status=canceled）
 * @param correlationId 可选关联 job.cancel messageId
 * @returns envelope
 */
export function buildJobCanceledEnvelope(
  party: OutboundParty,
  payload: JobPayload,
  correlationId?: string,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "job.canceled",
    ...(correlationId ? { correlationId } : {}),
    payload,
  });
}

/**
 * 构造 affair.update。
 *
 * @param party 寻址
 * @param payload 事务载荷
 * @returns envelope
 */
export function buildAffairUpdateEnvelope(
  party: OutboundParty,
  payload: AffairPayload,
): ProtocolEnvelope<any> {
  return createEnvelope({
    source: { kind: "companion", deviceId: party.desktopDeviceId },
    target: { kind: "phone", deviceId: party.phoneDeviceId },
    type: "affair.update",
    payload,
  });
}
