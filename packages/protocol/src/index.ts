/**
 * 协议包公共门面。
 *
 * 职责：导出协议版本、types、validators、message helpers、errors、ids 与 schema 登记。
 * 不拥有：companion 权限裁决、配对身份存储、OpenClaw 执行、控制面板渲染。
 * 纯函数：本门面只做 re-export；validators 保持 pure，不得 I/O。
 */

export { PROTOCOL_VERSION, type ProtocolVersion } from "./protocol-version.js";
export { PERMISSION_INTENT_TEXT_RULES, permissionInferenceText } from "./states/permission/intent-text.js";

export {
  createAttachId,
  createAffairId,
  createChatMessageId,
  createJobId,
  createMessageId,
  createPairingId,
  createPermissionRequestId,
  createSessionId,
} from "./ids/create-id.js";

export {
  createProtocolError,
  unknownMessageType,
  validationFailed,
  type ProtocolError,
} from "./errors/protocol-error.js";

export {
  AFFAIR_STATUSES,
  AFFAIR_TRANSITIONS,
  canTransitionAffairStatus,
  isAffairStatus,
  type AffairStatus,
} from "./states/affair-status.js";

export {
  JOB_STATUSES,
  JOB_TRANSITIONS,
  canTransitionJobStatus,
  isJobStatus,
  type JobStatus,
} from "./states/job-status.js";

export {
  PAIRING_STATUSES,
  canTransitionPairingStatus,
  isPairingStatus,
  type PairingStatus,
} from "./states/pairing-status.js";

export {
  PERMISSION_DECISIONS,
  effectOfPermissionDecision,
  isPermissionDecision,
  type PermissionDecision,
  type PermissionDecisionEffect,
} from "./states/permission/decision.js";

export {
  LANXING_CLAW_DNS_SD_PROTOCOL,
  LANXING_CLAW_DNS_SD_TYPE,
  DISCOVERY_TXT_KEYS,
  type DiscoveryTxtKey,
} from "./discovery/constants.js";

export {
  decodeDiscoveryTxt,
  encodeDiscoveryTxt,
  validateDiscoveryAdvertisement,
  type DiscoveryAdvertisement,
  type DiscoveryTxtRecord,
} from "./discovery/advertisement.js";

export type { EndpointKind, ProtocolEndpoint, ProtocolEnvelope } from "./messages/envelope.js";
export { MESSAGE_TYPES, isMessageType, type MessageType } from "./messages/message-type.js";
export { createEnvelope, type CreateEnvelopeInput } from "./messages/create-envelope.js";
export type { AffairActionResult, ProtocolResultAck, ProtocolAckSuccess, ProtocolAckFailure } from "./messages/result-ack.js";
export { validateProtocolResultAck } from "./validators/result-ack.js";
export {
  COMPANION_FC_CATALOG,
  COMPANION_FC_NAMES,
  getCompanionFcMapping,
  isCompanionFcName,
  type CompanionFcMapping,
  type CompanionFcName,
} from "./messages/companion-fc-catalog.js";

export {
  JOB_EVIDENCE_QUALITIES,
  JOB_RECENT_STEP_KINDS,
  PERMISSION_IDS,
  type AffairPayload,
  type JobEvidenceQuality,
  type JobPayload,
  type JobRecentStep,
  type JobRecentStepKind,
  type PairingChallengePayload,
  type PairingCompletedPayload,
  type PairingConfirmedPayload,
  type PairingDesktopApprovedPayload,
  type PairingRequestPayload,
  type PairingRevokedPayload,
  type PermissionId,
} from "./messages/payloads/core.js";

export type {
  ChatContextAttachPayload,
  ChatMessagePayload,
  ChatReadReceiptPayload,
  PermissionDecisionPayload,
  PermissionRequestPayload,
  ProposedScope,
  SessionAcceptedPayload,
  SessionClosedPayload,
  SessionHeartbeatPayload,
  SessionOpenPayload,
  SessionReauthRequiredPayload,
} from "./messages/payloads/session.js";

export {
  CONTROL_PANEL_SCHEMA,
  MESSAGE_PAYLOAD_SCHEMA,
  schemaFileForMessageType,
  type SchemaFileName,
} from "./schemas/registry.js";

export type { ValidateErr, ValidateOk, ValidateResult } from "./validators/result.js";
export { validateEnvelope } from "./validators/envelope.js";
export { validateMessage, validatePayloadForType } from "./validators/validate-message.js";
export {
  validateControlPanelSnapshot,
} from "./validators/ui/snapshot.js";
export {
  validateDiagnosticReport,
} from "./validators/ui/diagnostic.js";
export {
  validateLastErrorSummary,
  validatePermissionQueue,
} from "./validators/ui/queue.js";

/**
 * 返回协议包标识，供 workspace 联调与诊断探针使用。
 *
 * @returns 不含路径或凭据的包名字符串
 */
export function getProtocolPackageName(): string {
  return "@lanxin-claw/protocol";
}

export type { AffairClosePayload } from "./messages/affair-action.js";
export { validateAffairClosePayload } from "./validators/payloads/affair-job/close.js";

export { validateAffairActionResult } from "./validators/payloads/affair-job/action-result.js";
