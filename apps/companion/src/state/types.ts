/**
 * Companion backend 状态类型。
 *
 * 职责：描述真实 companion backend store 的最小运行态。
 * 不拥有：renderer UI、OpenClaw runtime、电话侧 affair store 持久化。
 * 纯函数：仅类型定义。
 */

import type {
  AffairPayload,
  ChatContextAttachPayload,
  ChatMessagePayload,
  ChatReadReceiptPayload,
  JobPayload,
  ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import type { BridgeActionDelivery } from "../bridge/contract.js";
import type { AffairActionRecord } from "../affairs/actions/types.js";
import type { AuditRecordView } from "../audit/types.js";

/** 消费回执及本地认证来源；旧镜像可缺来源字段。 */
export interface ChatReceiptRecord extends ChatReadReceiptPayload {
  phoneDeviceId?: string;
  desktopDeviceId?: string;
  receiptMessageId?: string;
}

/**
 * 后端已见消息记录。
 */
export interface SeenMessageRecord {
  /** message id */
  messageId: string;
  /** 第一次处理时间 */
  seenAt: string;
}

/**
 * Companion 设备与会话状态。
 */
export interface CompanionConnectionState {
  /** 电话设备 id */
  phoneDeviceId: string | null;
  /** 电话展示名 */
  phoneDisplayName: string | null;
  /** 配对 id */
  pairingId: string | null;
  /** session id */
  sessionId: string | null;
  /** 最近可见时间 */
  lastSeenAt: string | null;
  /** 是否已认证会话 */
  sessionAuthenticated: boolean;
}

/**
 * Backend store 快照。
 */
export interface CompanionBackendState {
  /** 启动时间毫秒 */
  startedAtMs: number;
  /** 最近更新时间 */
  updatedAt: string;
  /** 连接状态 */
  connection: CompanionConnectionState;
  /** 持久化关闭请求与幂等提交结果 */
  affairActions: Map<string, AffairActionRecord>;
  /** affairs 镜像 */
  affairs: Map<string, AffairPayload>;
  /** jobs 镜像 */
  jobs: Map<string, JobPayload>;
  /** chat 消息 */
  chatMessages: ChatMessagePayload[];
  /** context_attach 消息 */
  contextAttachments: ChatContextAttachPayload[];
  /** 已读回执 */
  chatReceipts: ChatReceiptRecord[];
  /** audit 视图 */
  auditRecords: AuditRecordView[];
  /** 最近 UI action 投递回执；只证明投递事实，不证明业务完成 */
  bridgeActionDeliveries: BridgeActionDelivery[];
  /** 最近错误 */
  lastError: {
    code: string;
    message: string;
    occurredAt: string;
    /** 关联事务 */
    affairId?: string | null;
    /** 关联 job */
    jobId?: string | null;
  } | null;
  /** 已处理消息 */
  seenMessages: Map<string, SeenMessageRecord>;
}

/**
 * 协议处理结果。
 */
export type ApplyProtocolResult =
  | { ok: true; duplicate?: boolean; envelope: ProtocolEnvelope }
  | { ok: false; code: string; message: string; retryable: boolean };
