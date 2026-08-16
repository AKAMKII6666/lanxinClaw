/**
 * Companion permission gate（桌面授权权威）。
 *
 * 职责：入队 permission.request、裁决 allow_once/allow_for_job/deny/require_more_context、
 * 检查授予是否仍有效；产出可映射到 permission.decision 的结果。
 * 不拥有：renderer 直连副作用、OpenClaw 执行、affair 关闭、凭据明文。
 * 副作用：仅更新本实例内存；不读写磁盘/网络。
 */

import {
  createPermissionRequestId,
  isPermissionDecision,
  type PermissionDecision,
  type PermissionDecisionPayload,
  type PermissionId,
} from "@lanxin-claw/protocol";
import { applyPermissionDecision } from "./apply-decision.js";
import { classifyPermissionPolicy, isAllowedByDefault } from "./policy/default-policy.js";
import type {
  GateDecisionResult,
  GatePermissionRequest,
  PermissionGrantRecord,
  PermissionQueueStatus,
} from "./types.js";
import type { PendingPermissionCardView, PermissionDecisionChoice } from "../views.js";

const ALL_DECISIONS: PermissionDecisionChoice[] = [
  "allow_once",
  "allow_for_job",
  "deny",
  "require_more_context",
];

/**
 * 内存版 permission gate。
 */
export class PermissionGate {
  #requests = new Map<string, GatePermissionRequest>();
  #queueStatus = new Map<string, PermissionQueueStatus>();
  #grants: PermissionGrantRecord[] = [];
  #grantSeq = 0;

  /**
   * 将请求入队；重复 id 拒绝。
   *
   * @param request 待确认请求
   * @returns 是否入队成功
   */
  enqueue(request: GatePermissionRequest): { ok: true } | { ok: false; code: string; message: string } {
    if (this.#requests.has(request.permissionRequestId)) {
      return {
        ok: false,
        code: "permission_duplicate",
        message: "permissionRequestId 已存在，拒绝重复入队",
      };
    }
    this.#requests.set(request.permissionRequestId, request);
    this.#queueStatus.set(request.permissionRequestId, "pending");
    return { ok: true };
  }

  /**
   * 应用用户决策；未知决策按 deny。
   *
   * @param permissionRequestId 请求 id
   * @param decision 决策
   * @param decidedAt 可选时间
   * @returns 裁决结果
   */
  decide(
    permissionRequestId: string,
    decision: PermissionDecision | string,
    decidedAt?: string,
  ): GateDecisionResult {
    const request = this.#requests.get(permissionRequestId);
    if (!request) {
      return {
        ok: false,
        code: "permission_not_found",
        message: "找不到对应的权限请求",
        actionBlocked: true,
        needsClarification: false,
      };
    }
    const normalized: PermissionDecision = isPermissionDecision(decision) ? decision : "deny";
    const at = decidedAt ?? new Date().toISOString();
    return applyPermissionDecision(
      { queueStatus: this.#queueStatus, grants: this.#grants },
      request,
      normalized,
      at,
      () => this.#nextGrantId(),
    );
  }

  /**
   * 读取已入队的权限请求（含 proposedScope），供编排层绑定工作区。
   *
   * @param permissionRequestId 请求 id
   * @returns 请求快照；不存在则 null
   */
  getRequest(permissionRequestId: string): GatePermissionRequest | null {
    const found = this.#requests.get(permissionRequestId);
    if (!found) {
      return null;
    }
    return {
      ...found,
      proposedScope: { ...found.proposedScope },
      requestedPermissions: [...found.requestedPermissions],
    };
  }

  /**
   * 检查 job 是否已持有某权限授予。
   * allow_once 在首次成功检查后消耗。
   *
   * @param jobId job id
   * @param permissionId 权限
   * @returns 是否允许执行
   */
  isGranted(jobId: string, permissionId: PermissionId): boolean {
    if (isAllowedByDefault(permissionId)) {
      return true;
    }
    const index = this.#grants.findIndex(
      (g) => g.active && g.jobId === jobId && g.permissionId === permissionId,
    );
    if (index < 0) {
      return false;
    }
    const grant = this.#grants[index];
    if (!grant) {
      return false;
    }
    if (grant.scope === "once") {
      grant.active = false;
    }
    return true;
  }

  /**
   * 某权限在未授予时的策略桶。
   *
   * @param permissionId 权限
   * @returns 策略桶
   */
  policyOf(permissionId: string) {
    return classifyPermissionPolicy(permissionId);
  }

  /**
   * 列出仍 pending 的卡片视图。
   *
   * @returns 待确认卡片
   */
  listPendingCards(): PendingPermissionCardView[] {
    const cards: PendingPermissionCardView[] = [];
    for (const [id, status] of this.#queueStatus) {
      if (status !== "pending") {
        continue;
      }
      const request = this.#requests.get(id);
      if (!request) {
        continue;
      }
      cards.push({
        permissionRequestId: request.permissionRequestId,
        requester: request.requester,
        affairId: request.affairId,
        jobId: request.jobId,
        reason: request.reason,
        risk: request.risk,
        scopeSummary: summarizeScope(request),
        denyConsequence: request.denyConsequence,
        availableDecisions: [...ALL_DECISIONS],
      });
    }
    return cards;
  }

  /**
   * 组装可发给 phone 的 permission.decision 载荷字段。
   *
   * @param result 成功的裁决结果
   * @param permissionRequestId 请求 id
   * @param jobId 可选 job
   * @returns payload 或 null
   */
  toDecisionPayload(
    result: GateDecisionResult,
    permissionRequestId: string,
    jobId?: string | null,
  ): PermissionDecisionPayload | null {
    if (!result.ok || !result.decision || !result.decidedAt) {
      return null;
    }
    const payload: PermissionDecisionPayload = {
      permissionRequestId,
      decision: result.decision,
      decidedAt: result.decidedAt,
    };
    if (jobId !== undefined) {
      payload.jobId = jobId;
    }
    return payload;
  }

  /**
   * @returns 下一 grantId
   */
  #nextGrantId(): string {
    this.#grantSeq += 1;
    return `grant_${this.#grantSeq}_${createPermissionRequestId().slice(5, 13)}`;
  }
}

/**
 * @param request 请求
 * @returns 范围摘要
 */
function summarizeScope(request: GatePermissionRequest): string {
  const perms = request.requestedPermissions.join(" · ");
  const root = request.proposedScope.workspaceRoot;
  if (root) {
    return `${perms} · ${root}`;
  }
  return perms;
}
