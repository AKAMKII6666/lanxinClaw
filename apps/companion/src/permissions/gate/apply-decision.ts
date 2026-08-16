/**
 * 将用户决策应用到 gate 内存状态（纯变换）。
 *
 * 职责：根据 allow_once / allow_for_job / deny / require_more_context 更新授予与队列态。
 * 不拥有：IPC、磁盘、OpenClaw、affair 关闭。
 * 纯函数：输入输出新状态；不修改入参对象图以外的全局。
 */

import { effectOfPermissionDecision, type PermissionDecision } from "@lanxin-claw/protocol";
import type {
  GateDecisionResult,
  GatePermissionRequest,
  PermissionGrantRecord,
  PermissionQueueStatus,
} from "./types.js";

/** applyDecision 的可变工作集 */
export interface GateMutableState {
  /** 请求 id → 队列态 */
  queueStatus: Map<string, PermissionQueueStatus>;
  /** 活跃授予 */
  grants: PermissionGrantRecord[];
}

/**
 * 应用决策；未知决策按 deny。
 *
 * @param state 可变工作集
 * @param request 原请求
 * @param decision 用户决策
 * @param decidedAt 决策时间
 * @param grantIdFactory 生成 grantId
 * @returns 裁决结果
 */
export function applyPermissionDecision(
  state: GateMutableState,
  request: GatePermissionRequest,
  decision: PermissionDecision,
  decidedAt: string,
  grantIdFactory: () => string,
): GateDecisionResult {
  const current = state.queueStatus.get(request.permissionRequestId);
  if (current !== "pending") {
    return {
      ok: false,
      code: "permission_not_pending",
      message: "该权限请求不在待确认队列，无法重复裁决",
      actionBlocked: true,
      needsClarification: false,
    };
  }

  const effect = effectOfPermissionDecision(decision);
  state.queueStatus.set(request.permissionRequestId, "decided");

  if (effect === "deny_action") {
    return {
      ok: true,
      decision,
      decidedAt,
      actionBlocked: true,
      needsClarification: false,
    };
  }

  if (effect === "request_clarification") {
    return {
      ok: true,
      decision,
      decidedAt,
      actionBlocked: true,
      needsClarification: true,
    };
  }

  const scope = effect === "grant_once" ? "once" : "job";
  for (const permissionId of request.requestedPermissions) {
    state.grants.push({
      grantId: grantIdFactory(),
      permissionRequestId: request.permissionRequestId,
      jobId: request.jobId,
      permissionId,
      scope,
      active: true,
      grantedAt: decidedAt,
    });
  }

  return {
    ok: true,
    decision,
    decidedAt,
    actionBlocked: false,
    needsClarification: false,
  };
}
