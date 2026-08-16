/**
 * Envelope 构造 helpers。
 *
 * 职责：组装符合 PROTOCOL_VERSION 的 ProtocolEnvelope，缺省填充 messageId / sentAt。
 * 不拥有：发送传输、鉴权、payload 业务校验（调用方应先 validate）。
 * 纯函数：除缺省 ID/时间外无 I/O。
 */

import { createMessageId } from "../ids/create-id.js";
import { PROTOCOL_VERSION } from "../protocol-version.js";
import type { ProtocolEnvelope, ProtocolEndpoint } from "./envelope.js";

/**
 * createEnvelope 入参。
 */
export interface CreateEnvelopeInput<TPayload = Record<string, unknown>> {
  /** 发送方 */
  source: ProtocolEndpoint;
  /** 接收方 */
  target: ProtocolEndpoint;
  /** message type */
  type: string;
  /** 载荷对象 */
  payload: TPayload;
  /** 可选预分配 messageId */
  messageId?: string;
  /** 可选关联 id */
  correlationId?: string;
  /** 可选发送时间；缺省为当前 UTC ISO */
  sentAt?: string;
}

/**
 * 构造协议 envelope；不校验 payload 形状。
 *
 * @param input 端点、type 与 payload
 * @returns 可序列化的 ProtocolEnvelope
 */
export function createEnvelope<TPayload = Record<string, unknown>>(
  input: CreateEnvelopeInput<TPayload>,
): ProtocolEnvelope<TPayload> {
  const envelope: ProtocolEnvelope<TPayload> = {
    protocolVersion: PROTOCOL_VERSION,
    messageId: input.messageId ?? createMessageId(),
    sentAt: input.sentAt ?? new Date().toISOString(),
    source: input.source,
    target: input.target,
    type: input.type,
    payload: input.payload,
  };
  if (input.correlationId !== undefined) {
    envelope.correlationId = input.correlationId;
  }
  return envelope;
}
