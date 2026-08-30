/**
 * 权限 ID 与 affair / job 载荷类型。
 *
 * 职责：描述 affair.* 与 job.* payload，以及共享 permissionId。
 * 不拥有：权限授予、OpenClaw 执行、事务关闭。
 * 纯函数：仅类型定义。
 */

import type { AffairStatus } from "../../states/affair-status.js";
import type { JobStatus } from "../../states/job-status.js";
import type { ProtocolVersion } from "../../protocol-version.js";

/** companion 可授予的权限 id；与 schemas/permission.schema.json 对齐 */
export const PERMISSION_IDS = [
  "workspace.read",
  "workspace.write",
  "command.run",
  "network.access",
  "git.read",
  "git.write",
  "secrets.read",
  "desktop.control",
] as const;

/** 权限标识 */
export type PermissionId = (typeof PERMISSION_IDS)[number];

/**
 * Affair 对象载荷；用于 create / update / resume / close。
 * worker completed 不得把 status 直接写成 closed。
 */
export interface AffairPayload {
  /** 事务稳定 id */
  affairId: string;
  /** 人类可读标题 */
  title: string;
  /** 责任人；MVP 固定 zhang-boss */
  ownerAgent: "zhang-boss";
  /** 事务生命周期状态 */
  status: AffairStatus;
  /** 上下文条目；非系统指令 */
  context: string[];
  /** 验收标准；关闭前须满足或用户明确取消 */
  acceptanceCriteria: string[];
  /** 阻塞原因；无阻塞时为 null 或省略 */
  blockedReason?: string | null;
  /** 恢复条件说明 */
  resumeCondition?: string | null;
  /** 当前关联 job；可空 */
  currentJobId?: string | null;
}

/**
 * Job 对象载荷；completed 只表示 worker 完成。
 */
export interface JobPayload {
  /** job 稳定 id */
  jobId: string;
  /** 所属 affair */
  affairId: string;
  /** 执行引擎；MVP 仅 openclaw */
  executor: "openclaw";
  /** job 执行状态 */
  status: JobStatus;
  /** job 用途；exploration 只为澄清上下文，不代表正式执行承诺 */
  purpose?: "execution" | "exploration";
  /** 执行目标摘要 */
  goal: string;
  /** 工作区提示路径；可空，非授权本身 */
  workspaceHint?: string | null;
  /** 已声明允许的权限 id 列表 */
  allowedPermissions: string[];
  /** 进度摘要 */
  progressSummary?: string;
  /** 阻塞原因 */
  blockedReason?: string | null;
  /** 恢复条件 */
  resumeCondition?: string | null;
  /** 关联权限请求 */
  permissionRequestId?: string | null;
  /** companion 对当前状态的稳定理由码；由 companion 生成，可空 */
  statusReasonCode?: string | null;
  /** companion 最近一次采纳状态证据的 ISO-8601 时间；由 companion 生成，可空 */
  statusObservedAt?: string | null;
}

/**
 * pairing.request 载荷。
 */
export interface PairingRequestPayload {
  /** 配对流程 id */
  pairingId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 电话展示名 */
  phoneDisplayName: string;
  /** 协议版本 */
  protocolVersion: ProtocolVersion;
  /** 能力声明；未知项可忽略 */
  capabilities: string[];
}

/**
 * pairing.challenge 载荷。
 */
export interface PairingChallengePayload {
  /** 配对流程 id */
  pairingId: string;
  /** 桌面设备 id */
  desktopDeviceId: string;
  /** 桌面展示名 */
  desktopDisplayName: string;
  /** 挑战串；非长期凭据 */
  challenge: string;
  /** 过期时间 ISO-8601 */
  expiresAt: string;
}

/**
 * pairing.confirmed 载荷。
 */
export interface PairingConfirmedPayload {
  /** 配对流程 id */
  pairingId: string;
  /** 挑战应答 */
  challengeResponse: string;
  /** 电话侧确认时间 */
  phoneConfirmedAt: string;
}

/**
 * pairing.desktop_approved 载荷。
 */
export interface PairingDesktopApprovedPayload {
  /** 配对流程 id */
  pairingId: string;
  /** 桌面侧批准时间 */
  desktopApprovedAt: string;
}

/**
 * pairing.completed 载荷。
 */
export interface PairingCompletedPayload {
  /** 配对流程 id */
  pairingId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 桌面设备 id */
  desktopDeviceId: string;
  /** 配对共享秘密；仅用于后续 session.open HMAC，不得记录日志 */
  pairingSecret: string;
  /** 配对完成时间 */
  pairedAt: string;
}

/**
 * pairing.revoked 载荷。
 */
export interface PairingRevokedPayload {
  /** 可选配对流程 id */
  pairingId?: string | null;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 桌面设备 id */
  desktopDeviceId: string;
  /** 撤销原因 */
  reason: string;
  /** 撤销时间 */
  revokedAt: string;
}
