/**
 * 入站协议消息路由。
 *
 * 职责：validateMessage 后分发 pairing / session / affair / job。
 * 不拥有：传输层分帧、权限 UI 确认、OpenClaw core。
 * 副作用：调用 handler 更新 store 并 emit；拒绝非法消息。
 */

import {
  createProtocolError,
  validateMessage,
  type ProtocolEnvelope,
  type ProtocolError,
} from "@lanxin-claw/protocol";
import type { MockCompanionConfig } from "../config.js";
import {
  handleAffairCreate,
  handleJobCreate,
} from "../jobs/handle-affair-job.js";
import {
  handlePairingConfirmed,
  handlePairingRequest,
  handleSessionOpen,
  type EmitEnvelope,
} from "../pairing/handle-pairing.js";
import type { MemoryStore } from "../store/memory-store.js";

/**
 * 路由结果。
 */
export type RouteResult = { ok: true } | { ok: false; error: ProtocolError };

/**
 * 路由一条入站 JSON 消息。
 *
 * @param store 内存 store
 * @param config 配置
 * @param raw 原始 JSON
 * @param emit 出站回调
 * @returns 路由结果
 */
export function routeInboundMessage(
  store: MemoryStore,
  config: MockCompanionConfig,
  raw: unknown,
  emit: EmitEnvelope,
): RouteResult {
  const validated = validateMessage(raw);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  const inbound = validated.value;
  switch (inbound.type) {
    case "pairing.request":
      return handlePairingRequest(store, config, inbound, emit);
    case "pairing.confirmed":
      return handlePairingConfirmed(store, config, inbound, emit);
    case "session.open":
      return handleSessionOpen(store, config, inbound, emit);
    case "affair.create":
      return handleAffairCreate(store, config, inbound, emit);
    case "job.create":
      return handleJobCreate(store, config, inbound, emit);
    case "session.heartbeat":
      return { ok: true };
    default:
      return {
        ok: false,
        error: createProtocolError(
          "unsupported_in_mock",
          `mock companion 本轮未实现入站 type: ${inbound.type}`,
          false,
          { type: inbound.type },
        ),
      };
  }
}

/**
 * 构造协议错误响应 envelope（非标准 type，仅供本地诊断）。
 *
 * @param config 配置
 * @param phoneDeviceId 目标电话设备；未知时用 phone_unknown
 * @param error 协议错误
 * @param correlationId 关联入站 messageId
 * @returns 可序列化错误对象（HTTP/WS 共用）
 */
export function buildErrorBody(
  config: MockCompanionConfig,
  phoneDeviceId: string | undefined,
  error: ProtocolError,
  correlationId?: string,
): Record<string, unknown> {
  return {
    ok: false,
    companionDeviceId: config.desktopDeviceId,
    targetDeviceId: phoneDeviceId ?? "phone_unknown",
    correlationId: correlationId ?? null,
    error,
  };
}

/**
 * 从原始对象尽力读取 source.deviceId。
 *
 * @param raw 原始值
 * @returns deviceId 或 undefined
 */
export function peekSourceDeviceId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const source = (raw as ProtocolEnvelope).source;
  if (!source || typeof source !== "object") {
    return undefined;
  }
  return typeof source.deviceId === "string" ? source.deviceId : undefined;
}
