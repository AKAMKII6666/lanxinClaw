/**
 * Permission gate 内部类型。
 *
 * 职责：描述待确认请求、授予记录与裁决结果。
 * 不拥有：UI 渲染、OpenClaw 执行、affair 关闭。
 * 纯函数：仅类型与常量。
 */

import type { PermissionId, PermissionDecision, ProposedScope } from "@lanxin-claw/protocol";

/** 默认策略桶 */
export type PermissionPolicyBucket = "default_allow" | "needs_confirm" | "default_deny";

/** 队列项状态 */
export type PermissionQueueStatus = "pending" | "decided" | "expired";

/** 授予作用域 */
export type PermissionGrantScope = "once" | "job";

/**
 * 入队的权限请求（companion 权威侧）。
 */
export interface GatePermissionRequest {
  /** 与 permission.request 对齐 */
  permissionRequestId: string;
  /** 关联 job */
  jobId: string;
  /** 可选关联 affair */
  affairId: string | null;
  /** 请求方 */
  requester: "zhang-boss" | "companion" | "openclaw-adapter";
  /** 请求权限 */
  requestedPermissions: PermissionId[];
  /** 原因 */
  reason: string;
  /** 风险 */
  risk: "low" | "medium" | "high";
  /** 建议范围 */
  proposedScope: ProposedScope;
  /** 拒绝后果文案 */
  denyConsequence: string;
  /** 入队时间 */
  requestedAt: string;
  /** 过期时间；可空 */
  expiresAt: string | null;
}

/**
 * 已生效授予；allow_once 在首次 check 后消耗。
 */
export interface PermissionGrantRecord {
  /** 授予 id */
  grantId: string;
  /** 关联请求 */
  permissionRequestId: string;
  /** job 范围 */
  jobId: string;
  /** 权限 */
  permissionId: PermissionId;
  /** once 或整 job */
  scope: PermissionGrantScope;
  /** 是否仍可用 */
  active: boolean;
  /** 授予时间 */
  grantedAt: string;
}

/**
 * 裁决结果；含可发给 phone 的 decision 字段。
 */
export interface GateDecisionResult {
  /** 是否接受该决策 */
  ok: boolean;
  /** 失败时的稳定码 */
  code?: string;
  /** 失败说明 */
  message?: string;
  /** 生效决策 */
  decision?: PermissionDecision;
  /** 决策时间 */
  decidedAt?: string;
  /** 决策后 job 是否仍不得执行该动作 */
  actionBlocked: boolean;
  /** 是否应回到澄清而非静默重试 */
  needsClarification: boolean;
}
