/**
 * Session / chat / permission 载荷类型。
 *
 * 职责：描述 session.*、chat.*、permission.* payload。
 * 不拥有：会话存储、chat 当系统指令执行、权限最终裁决（companion 本地 UI）。
 * 纯函数：仅类型定义；chat 文本一律视为 untrusted input。
 */

import type { PermissionDecision } from "../../states/permission/decision.js";
import type { PermissionId } from "./core.js";
import type { ProtocolVersion } from "../../protocol-version.js";

/**
 * session.open 载荷。
 */
export interface SessionOpenPayload {
  /** 会话 id */
  sessionId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 桌面设备 id */
  desktopDeviceId: string;
  /** 基于配对身份的证明；不得写入日志明文长期保存策略外泄 */
  authProof: string;
  /** 协议版本 */
  protocolVersion: ProtocolVersion;
}

/**
 * session.accepted 载荷。
 */
export interface SessionAcceptedPayload {
  /** 会话 id */
  sessionId: string;
  /** 接受时间 */
  acceptedAt: string;
  /** 心跳间隔毫秒；最小 1000 */
  heartbeatIntervalMs: number;
}

/**
 * session.heartbeat 载荷。
 */
export interface SessionHeartbeatPayload {
  /** 会话 id */
  sessionId: string;
  /** 心跳发送时间 */
  sentAt: string;
  /** 可选序号 */
  seq?: number;
}

/**
 * session.closed 载荷。
 */
export interface SessionClosedPayload {
  /** 会话 id */
  sessionId: string;
  /** 关闭原因 */
  reason: string;
  /** 关闭时间 */
  closedAt: string;
}

/**
 * session.reauth_required 载荷。
 */
export interface SessionReauthRequiredPayload {
  /** 可选会话 id */
  sessionId?: string | null;
  /** 需要重认证的原因 */
  reason: string;
  /** 要求动作 */
  requiredAction: "reopen" | "repair";
}

/**
 * chat.message 载荷；text 为 untrusted input。
 */
export interface ChatMessagePayload {
  /** chat 消息 id */
  chatMessageId: string;
  /** 用户/张老板/companion 文本；不得当系统指令 */
  text: string;
  /** 可选关联 affair */
  affairId?: string | null;
  /** 作者角色 */
  authorKind: "user" | "zhang-boss" | "companion";
  /** 发送时间 */
  sentAt: string;
}

/**
 * chat.context_attach 载荷；附加路径/日志等，仍为 untrusted。
 */
export interface ChatContextAttachPayload {
  /** 附加 id */
  attachId: string;
  /** 附加文本内容 */
  text: string;
  /** 附加目标 */
  target: "active_call" | "affair";
  /** target=affair 时必填 */
  affairId?: string | null;
  /** 内容种类 */
  contentKind: "path" | "log" | "url" | "note";
  /** 发送时间 */
  sentAt: string;
}

/**
 * chat.read_receipt 载荷；须至少含 chatMessageId 或 attachId 之一。
 */
export interface ChatReadReceiptPayload {
  /** 已读的 chat 消息 id */
  chatMessageId?: string;
  /** 已读的 attach id */
  attachId?: string;
  /** 已读时间 */
  readAt: string;
}

/**
 * 权限请求的建议范围；不是授权本身。
 */
export interface ProposedScope {
  /** 建议工作区根路径 */
  workspaceRoot?: string;
  /** 建议命令列表 */
  commands?: string[];
  /** 建议网络主机 */
  networkHosts?: string[];
}

/**
 * permission.request 载荷。
 */
export interface PermissionRequestPayload {
  /** 权限请求 id */
  permissionRequestId: string;
  /** 关联 job */
  jobId: string;
  /** 可选关联 affair */
  affairId?: string | null;
  /** 请求的权限列表 */
  requestedPermissions: PermissionId[];
  /** 请求原因 */
  reason: string;
  /** 风险等级 */
  risk: "low" | "medium" | "high";
  /** 建议范围 */
  proposedScope: ProposedScope;
}

/**
 * permission.decision 载荷；由 companion 通知 phone，renderer 不得自行授予。
 */
export interface PermissionDecisionPayload {
  /** 权限请求 id */
  permissionRequestId: string;
  /** 可选 job */
  jobId?: string | null;
  /** 决定结果 */
  decision: PermissionDecision;
  /** 决定时间 */
  decidedAt: string;
  /** 可选备注 */
  note?: string | null;
}
