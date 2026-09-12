/**
 * 权限请求的展示投影。
 * 职责：构造待授权卡与已裁决的协议载荷。不拥有：授予或撤销权威。纯函数，无 I/O。
 */
import type { PermissionDecisionPayload } from "@lanxin-claw/protocol";
import type { PendingPermissionCardView, PermissionDecisionChoice } from "../../views.js";
import type { GateDecisionResult, GatePermissionRequest, PermissionQueueStatus } from "../types.js";

const ALL_DECISIONS: PermissionDecisionChoice[] = ["allow_once", "allow_for_job", "deny", "require_more_context"];

/**
 * 投影仍待处理的请求。
 * @param requests 权限请求镜像
 * @param statuses 请求状态
 * @returns 独立的卡片数组
 */
export function projectPendingCards(requests: ReadonlyMap<string, GatePermissionRequest>, statuses: ReadonlyMap<string, PermissionQueueStatus>): PendingPermissionCardView[] {
  const cards: PendingPermissionCardView[] = [];
  for (const [id, status] of statuses) {
    if (status !== "pending") continue;
    const request = requests.get(id);
    if (!request) continue;
    const permissions = request.requestedPermissions.join(" · ");
    const root = request.proposedScope.workspaceRoot;
    cards.push({ permissionRequestId: request.permissionRequestId, requester: request.requester,
      affairId: request.affairId, jobId: request.jobId, reason: request.reason, risk: request.risk,
      scopeSummary: root ? `${permissions} · ${root}` : permissions, denyConsequence: request.denyConsequence,
      availableDecisions: [...ALL_DECISIONS] });
  }
  return cards;
}

/**
 * 序列化已完成的裁决，不产生新授予。
 * @param result gate 已作出的裁决
 * @param permissionRequestId 原请求 ID
 * @param jobId 原关联 job
 * @returns 可发送的结果，未裁决则 null
 */
export function projectPermissionDecision(result: GateDecisionResult, permissionRequestId: string, jobId?: string | null): PermissionDecisionPayload | null {
  if (!result.ok || !result.decision || !result.decidedAt) return null;
  return { permissionRequestId, decision: result.decision, decidedAt: result.decidedAt,
    ...(jobId !== undefined ? { jobId } : {}) };
}
