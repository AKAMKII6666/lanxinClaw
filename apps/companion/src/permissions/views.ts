/**
 * 权限页安全视图模型（可进 renderer）。
 *
 * 职责：描述已配对设备、job 权限与待确认卡片的展示字段。
 * 不拥有：permission gate 裁决、pairingSecret、凭据明文、OpenClaw。
 * 纯函数：仅类型；视图不得含 pairingSecret / API key。
 */

import type { AuditRecordView } from "../audit/types.js";

/** 权限决策选项；与协议 permission.decision 对齐 */
export type PermissionDecisionChoice =
  | "allow_once"
  | "allow_for_job"
  | "deny"
  | "require_more_context";

/**
 * 已配对设备摘要；供权限页列表与 revoke 入口。
 */
export interface PairedDeviceView {
  /** 配对 id */
  pairingId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 展示名 */
  phoneDisplayName: string;
  /** 桌面设备 id（revoke 主键之一） */
  desktopDeviceId: string;
  /** 连接摘要：connected / disconnected / revoked */
  connectionLabel: string;
  /** 截断指纹提示；不得是完整私钥或 pairingSecret */
  fingerprintHint: string | null;
  /** 是否仍可操作 revoke */
  canRevoke: boolean;
}

/**
 * 当前 job 下的单项权限授予态。
 */
export interface JobPermissionGrantView {
  /** permission id，如 workspace.write */
  permissionId: string;
  /** 作用范围摘要（路径/命令/主机）；不得含 secret */
  scopeSummary: string;
  /** 授予态：allowed / pending / needs_confirm / denied */
  grantStatus: string;
}

/**
 * 待确认权限卡片。
 */
export interface PendingPermissionCardView {
  /** 与 permission.request 对齐 */
  permissionRequestId: string;
  /** 请求方 */
  requester: "zhang-boss" | "companion" | "openclaw-adapter";
  /** 关联事务；可空 */
  affairId: string | null;
  /** 关联事务标题；可空 */
  affairTitle?: string | null;
  /** 关联 job */
  jobId: string;
  /** 请求原因 */
  reason: string;
  /** 风险等级 */
  risk: "low" | "medium" | "high";
  /** 作用范围摘要 */
  scopeSummary: string;
  /** 拒绝后果说明 */
  denyConsequence: string;
  /** UI 可点决策 */
  availableDecisions: PermissionDecisionChoice[];
}

/**
 * 权限页聚合状态。
 */
export interface PermissionPanelView {
  /** 已配对设备 */
  pairedDevices: PairedDeviceView[];
  /** 当前 job 权限；无 job 时为空数组 */
  jobPermissions: JobPermissionGrantView[];
  /** 当前 job id 标签；无则为 null */
  currentJobId: string | null;
  /** 待确认卡片 */
  pendingCards: PendingPermissionCardView[];
  /** 审计摘要行 */
  auditRecords: AuditRecordView[];
}
