/**
 * 权限与高风险动作审计记录类型。
 *
 * 职责：定义可持久化的审计条目字段；禁止含凭据明文。
 * 不拥有：权限裁决权威、OpenClaw、affair 关闭。
 * 纯函数：仅类型。
 */

/** 审计事件类别 */
export type AuditEventKind =
  | "pairing"
  | "permission"
  | "job"
  | "high_risk_action"
  | "acceptance";

/**
 * 一条审计记录；不得含 API key / token / 私钥 / pairingSecret。
 */
export interface AuditRecord {
  /** 记录 id */
  auditId: string;
  /** 类别 */
  kind: AuditEventKind;
  /** 发生时间 ISO */
  at: string;
  /** 摘要（用户可见） */
  summary: string;
  /** 关联事务；可空 */
  affairId: string | null;
  /** 关联 job；可空 */
  jobId: string | null;
  /** 关联权限请求；可空 */
  permissionRequestId: string | null;
  /** 决策或结果标签；可空 */
  outcome: string | null;
  /** 风险；可空 */
  risk: "low" | "medium" | "high" | null;
}

/**
 * 权限页展示用的审计行。
 */
export interface AuditRecordView {
  /** 记录 id */
  auditId: string;
  /** 类别标签 */
  kindLabel: string;
  /** 时间 */
  at: string;
  /** 摘要 */
  summary: string;
  /** 结果标签；可空 */
  outcome: string | null;
}
