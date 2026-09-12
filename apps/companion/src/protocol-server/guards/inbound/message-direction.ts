/**
 * 入站 envelope 方向校验（phone→companion WS）。
 *
 * 职责：按协议消息目录拒绝 companion→phone 类型伪造入站。
 * 不拥有：session 认证、backend 写入。
 * 纯函数：无 I/O。
 */

import { isMessageType, type MessageType, type ProtocolEnvelope } from "@lanxin-claw/protocol";

/** 方向规则 */
type DirectionRule = "phone_to_companion" | "companion_to_phone" | "either";

/** type → 允许入站方向（自 phone socket） */
const DIRECTION_RULES: Record<MessageType, DirectionRule> = {
  "pairing.request": "phone_to_companion",
  "pairing.challenge": "companion_to_phone",
  "pairing.confirmed": "phone_to_companion",
  "pairing.desktop_approved": "companion_to_phone",
  "pairing.completed": "companion_to_phone",
  "pairing.revoked": "companion_to_phone",
  "session.open": "phone_to_companion",
  "session.accepted": "companion_to_phone",
  "session.heartbeat": "either",
  "session.closed": "either",
  "session.reauth_required": "companion_to_phone",
  "affair.create": "phone_to_companion",
  "affair.update": "either",
  "affair.resume": "phone_to_companion",
  "affair.close": "phone_to_companion",
  "job.create": "phone_to_companion",
  "job.accepted": "companion_to_phone",
  "job.progress": "companion_to_phone",
  "job.needs_permission": "companion_to_phone",
  "job.blocked": "companion_to_phone",
  "job.completed": "companion_to_phone",
  "job.failed": "companion_to_phone",
  "job.cancel": "phone_to_companion",
  "job.canceled": "companion_to_phone",
  "chat.message": "either",
  "chat.context_attach": "companion_to_phone",
  "chat.read_receipt": "phone_to_companion",
  "permission.request": "companion_to_phone",
  "permission.decision": "companion_to_phone",
};

/** 入站方向校验结果 */
export type InboundDirectionResult =
  | { ok: true }
  | { ok: false; code: string; message: string; retryable: false };

/**
 * 校验自 phone WebSocket 入站 envelope 的方向与端点。
 *
 * @param envelope 已 validateMessage 的 envelope
 * @returns 通过或拒绝
 */
export function validateInboundFromPhone(envelope: ProtocolEnvelope): InboundDirectionResult {
  if (!isMessageType(envelope.type)) {
    return {
      ok: false,
      code: "unknown_message_type",
      message: `未知 message type: ${envelope.type}`,
      retryable: false,
    };
  }
  const rule = DIRECTION_RULES[envelope.type];
  if (rule === "companion_to_phone") {
    return {
      ok: false,
      code: "inbound_direction_rejected",
      message: `${envelope.type} 为 companion→phone，不得由 phone 入站伪造`,
      retryable: false,
    };
  }
  if (envelope.source.kind !== "phone" || envelope.target.kind !== "companion") {
    return {
      ok: false,
      code: "inbound_direction_invalid",
      message: "入站业务消息须 source.kind=phone 且 target.kind=companion",
      retryable: false,
    };
  }
  return { ok: true };
}
