/**
 * Envelope 与端点类型。
 *
 * 职责：描述 phone↔companion↔adapter 的统一 wire envelope。
 * 不拥有：payload 业务语义、鉴权裁决、传输层分帧。
 * 纯函数：仅类型与常量；无运行时副作用。
 */

import type { ProtocolVersion } from "../protocol-version.js";

/** 端点角色 */
export type EndpointKind = "phone" | "companion" | "adapter";

/**
 * 消息端点：身份以配对 deviceId 为准，不以 IP/端口为准。
 */
export interface ProtocolEndpoint {
  /** 端点角色 */
  kind: EndpointKind;
  /** 稳定设备身份；不得编码 secret */
  deviceId: string;
}

/**
 * 统一协议 envelope；与 schemas/envelope.schema.json 对齐。
 */
export interface ProtocolEnvelope<TPayload = Record<string, unknown>> {
  /** wire 协议版本，当前 draft 为 0.1 */
  protocolVersion: ProtocolVersion;
  /** 本条消息唯一 id */
  messageId: string;
  /** 关联请求的 messageId；响应当填 */
  correlationId?: string;
  /** ISO-8601 发送时间 */
  sentAt: string;
  /** 发送方 */
  source: ProtocolEndpoint;
  /** 接收方 */
  target: ProtocolEndpoint;
  /** `domain.action` 消息类型 */
  type: string;
  /** 与 type 对应的载荷 */
  payload: TPayload;
}
