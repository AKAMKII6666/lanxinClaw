/**
 * Bridge 事务动作的后端状态门闩。
 *
 * 职责：在 host 接受 UI action 前校验 affair 状态与 session 前置条件。
 * 不拥有：renderer、协议广播、权限 gate、OpenClaw 执行。
 * 纯函数：只读 backend state。
 */

import { precheckAffairClose } from "../affairs/actions/guards/precheck.js";
import { canTransitionAffairStatus } from "@lanxin-claw/protocol";
import type { BridgeActionResult, BridgeUiAction } from "../bridge/contract.js";
import type { PermissionGate } from "../permissions/gate/permission-gate.js";
import type { CompanionBackendState } from "../state/types.js";

type AffairBridgeAction = Extract<BridgeUiAction, { affairId: string }>;

const SESSION_REQUIRED_AFFAIR_ACTIONS = new Set<BridgeUiAction["type"]>([
  "affair.pause",
  "affair.resume",
  "affair.cancel",
  "affair.accept",
  "affair.requestRevision",
]);

/**
 * 校验事务类 bridge action 是否具备当前状态证据。
 *
 * @param state backend state
 * @param action UI 动作
 * @returns 失败结果；通过时为 null
 */
export function validateBridgeActionAgainstState(
  state: CompanionBackendState,
  action: BridgeUiAction,
  gate?: PermissionGate,
): BridgeActionResult | null {
  if (action.type === "permission.decide") {
    return gate ? validatePermissionDecisionAction(state, action, gate) : null;
  }
  if (!isAffairBridgeAction(action)) {
    return null;
  }
  const affair = state.affairs.get(action.affairId);
  if (!affair) {
    return bridgeActionError("affair_not_found", "找不到对应事务", false);
  }
  const sessionError = validateSessionRequirement(state, action);
  if (sessionError) {
    return sessionError;
  }
  switch (action.type) {
    case "affair.accept":
      return validateAcceptAction(state, action);
    case "affair.requestRevision":
      return affair.status === "waiting_acceptance"
        ? null
        : bridgeActionError("affair_not_waiting_acceptance", "只有待验收事务才能要求继续处理", false);
    case "affair.requestAcceptance":
      return affair.status === "waiting_acceptance"
        ? null
        : bridgeActionError("affair_not_waiting_acceptance", "只有待验收事务才能请求验收回报", false);
    case "affair.cancel":
      return validateTransition(affair.status, "canceled", "affair_cancel_rejected", "不能取消");
    case "affair.pause":
      return validateTransition(affair.status, "paused", "affair_pause_rejected", "不能暂停");
    case "affair.resume":
      return validateTransition(affair.status, "running", "affair_resume_rejected", "不能继续处理");
    default:
      return null;
  }
}

function validatePermissionDecisionAction(
  state: CompanionBackendState,
  action: Extract<BridgeUiAction, { type: "permission.decide" }>,
  gate: PermissionGate,
): BridgeActionResult | null {
  const request = gate.getRequest(action.permissionRequestId);
  if (!request) {
    return bridgeActionError("permission_not_found", "找不到对应的权限请求", false);
  }
  if ([...state.affairActions.values()].some((record) => record.phase === "pending" && record.command.affairId === request.affairId)) {
    return bridgeActionError("affair_closing", "事务正在关闭，该权限请求不能再授予", false);
  }
  const queueStatus = gate.getQueueStatus(action.permissionRequestId);
  if (queueStatus !== "pending") {
    return bridgeActionError(
      queueStatus === "expired" ? "permission_expired" : "permission_not_pending",
      queueStatus === "expired" ? "该权限请求已失效，请刷新后再操作" : "该权限请求不在待确认队列，无法重复裁决",
      false,
    );
  }
  if (action.decision !== "allow_once" && action.decision !== "allow_for_job") {
    return null;
  }
  const job = state.jobs.get(request.jobId);
  if (!job || job.status !== "needs_permission") {
    return bridgeActionError("permission_not_executable", "当前 job 已不能从该权限请求继续执行", false);
  }
  const affairId = request.affairId ?? job.affairId;
  const affair = affairId ? state.affairs.get(affairId) : undefined;
  if (!affair) {
    return bridgeActionError("permission_not_executable", "找不到该权限请求关联的事务", false);
  }
  if (affair.status === "closed" || affair.status === "canceled") {
    return bridgeActionError("affair_terminal_for_permission", "事务已经结束，不能再授权执行", false);
  }
  if (job.purpose !== "exploration" && affair.currentJobId !== job.jobId) {
    return bridgeActionError("permission_not_current_job", "该权限请求不属于当前执行 job，不能授权", false);
  }
  return null;
}

function isAffairBridgeAction(action: BridgeUiAction): action is AffairBridgeAction {
  return "affairId" in action && action.type.startsWith("affair.");
}

function validateSessionRequirement(
  state: CompanionBackendState,
  action: AffairBridgeAction,
): BridgeActionResult | null {
  if (!SESSION_REQUIRED_AFFAIR_ACTIONS.has(action.type)) {
    return null;
  }
  if (!state.connection.sessionAuthenticated) {
    return bridgeActionError("session_required", "需要已认证电话会话才能同步给张老板", true);
  }
  return state.connection.phoneDeviceId
    ? null
    : bridgeActionError("phone_required", "没有已配对电话，无法同步事务动作", true);
}

function validateAcceptAction(
  state: CompanionBackendState,
  action: Extract<BridgeUiAction, { type: "affair.accept" }>,
): BridgeActionResult | null {
  const error = precheckAffairClose(state, { affairId: action.affairId, status: "closed",
    expectedCurrentJobId: action.expectedCurrentJobId, acceptanceSummary: action.acceptanceSummary });
  return error ? { ok: false, error } : null;
}

function validateTransition(
  from: Parameters<typeof canTransitionAffairStatus>[0],
  to: Parameters<typeof canTransitionAffairStatus>[1],
  code: string,
  actionLabel: string,
): BridgeActionResult | null {
  return canTransitionAffairStatus(from, to)
    ? null
    : bridgeActionError(code, `事务状态 ${from} ${actionLabel}`, false);
}

function bridgeActionError(
  code: string,
  message: string,
  retryable: boolean,
): BridgeActionResult {
  return {
    ok: false,
    error: { code, message, retryable },
  };
}
