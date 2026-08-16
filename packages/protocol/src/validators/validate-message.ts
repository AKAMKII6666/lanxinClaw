/**
 * 按 message type 分发 payload 校验，并组合 envelope 全量校验。
 *
 * 职责：validateMessage / validatePayloadForType 入口；未知 type 安全拒绝。
 * 不拥有：传输、鉴权状态、控制面板 UI 契约。
 * 纯函数：无 I/O。
 */

import { unknownMessageType } from "../errors/protocol-error.js";
import type { ProtocolEnvelope } from "../messages/envelope.js";
import { isMessageType, type MessageType } from "../messages/message-type.js";
import { validateEnvelope } from "./envelope.js";
import {
  validateChatContextAttachPayload,
  validateChatMessagePayload,
  validateChatReadReceiptPayload,
} from "./payloads/chat/chat.js";
import {
  validatePermissionDecisionPayload,
} from "./payloads/permission/decision.js";
import {
  validatePermissionRequestPayload,
} from "./payloads/permission/request.js";
import {
  validatePairingChallengePayload,
  validatePairingCompletedPayload,
  validatePairingConfirmedPayload,
  validatePairingDesktopApprovedPayload,
  validatePairingRequestPayload,
  validatePairingRevokedPayload,
} from "./payloads/pairing/pairing.js";
import {
  validateSessionAcceptedPayload,
  validateSessionClosedPayload,
  validateSessionHeartbeatPayload,
  validateSessionOpenPayload,
  validateSessionReauthRequiredPayload,
} from "./payloads/session/session.js";
import { validateAffairPayload, validateJobPayload } from "./payloads/affair-job/affair-job.js";
import type { ValidateResult } from "./result.js";

type PayloadValidator = (value: unknown) => ValidateResult<unknown>;

const PAYLOAD_VALIDATORS: Record<MessageType, PayloadValidator> = {
  "pairing.request": validatePairingRequestPayload,
  "pairing.challenge": validatePairingChallengePayload,
  "pairing.confirmed": validatePairingConfirmedPayload,
  "pairing.desktop_approved": validatePairingDesktopApprovedPayload,
  "pairing.completed": validatePairingCompletedPayload,
  "pairing.revoked": validatePairingRevokedPayload,
  "session.open": validateSessionOpenPayload,
  "session.accepted": validateSessionAcceptedPayload,
  "session.heartbeat": validateSessionHeartbeatPayload,
  "session.closed": validateSessionClosedPayload,
  "session.reauth_required": validateSessionReauthRequiredPayload,
  "affair.create": validateAffairPayload,
  "affair.update": validateAffairPayload,
  "affair.resume": validateAffairPayload,
  "affair.close": validateAffairPayload,
  "job.create": validateJobPayload,
  "job.accepted": validateJobPayload,
  "job.progress": validateJobPayload,
  "job.needs_permission": validateJobPayload,
  "job.blocked": validateJobPayload,
  "job.completed": validateJobPayload,
  "job.failed": validateJobPayload,
  "job.cancel": validateJobPayload,
  "chat.message": validateChatMessagePayload,
  "chat.context_attach": validateChatContextAttachPayload,
  "chat.read_receipt": validateChatReadReceiptPayload,
  "permission.request": validatePermissionRequestPayload,
  "permission.decision": validatePermissionDecisionPayload,
};

/**
 * 按已知 type 校验 payload。
 *
 * @param type message type 字符串
 * @param payload 载荷
 * @returns 收窄后的 payload 或失败；未知 type 返回 unknown_message_type
 */
export function validatePayloadForType(type: string, payload: unknown): ValidateResult<unknown> {
  if (!isMessageType(type)) {
    return { ok: false, error: unknownMessageType(type) };
  }
  return PAYLOAD_VALIDATORS[type](payload);
}

/**
 * 校验完整 envelope（外壳 + 按 type 的 payload）。
 *
 * @param value 任意 JSON 值
 * @returns 通过校验的 ProtocolEnvelope 或失败
 */
export function validateMessage(value: unknown): ValidateResult<ProtocolEnvelope> {
  const envelope = validateEnvelope(value);
  if (!envelope.ok) {
    return envelope;
  }
  const payload = validatePayloadForType(envelope.value.type, envelope.value.payload);
  if (!payload.ok) {
    return payload;
  }
  return {
    ok: true,
    value: {
      ...envelope.value,
      payload: payload.value as Record<string, unknown>,
    },
  };
}
