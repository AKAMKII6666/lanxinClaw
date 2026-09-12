/**
 * Companion permission gate（桌面授权权威）。
 *
 * 职责：入队 permission.request、裁决 allow_once/allow_for_job/deny/require_more_context、
 * 检查授予是否仍有效；产出可映射到 permission.decision 的结果。
 * 不拥有：renderer 直连副作用、OpenClaw 执行、affair 关闭、凭据明文。
 * 副作用：仅更新本实例内存；不读写磁盘/网络。
 */
import { restorePermissionGate, snapshotPermissionGate, type PermissionGateSnapshot } from "./persistence/snapshot.js";
import { projectPendingCards, projectPermissionDecision } from "./projection/cards.js";
import { grantableRequestIds, pendingRequestIds } from "./projection/requests.js";


import {
createPermissionRequestId,
isPermissionDecision,
type PermissionDecision,
type PermissionDecisionPayload,
type PermissionId,
} from "@lanxin-claw/protocol";
import type { PendingPermissionCardView } from "../views.js";
import { applyPermissionDecision } from "./apply-decision.js";
import { classifyPermissionPolicy, isAllowedByDefault } from "./policy/default-policy.js";
import type {
GateDecisionResult,
GatePermissionRequest,
PermissionGrantRecord,
PermissionQueueStatus,
} from "./types.js";

/**
 * 内存版 permission gate。
 */
export class PermissionGate {
  #requests = new Map<string, GatePermissionRequest>();
  #queueStatus = new Map<string, PermissionQueueStatus>();
  #grants: PermissionGrantRecord[] = [];
  #grantSeq = 0;
  #onChange: (() => void) | null = null;

  /**
   * 落盘回调；hydrate 后的变更会触发。
   *
   * @param onChange 变更回调
   */
  setOnChange(onChange: (() => void) | null): void {
    this.#onChange = onChange;
  }

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
    this.#onChange?.();
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
    const result = applyPermissionDecision(
      { queueStatus: this.#queueStatus, grants: this.#grants },
      request,
      normalized,
      at,
      () => this.#nextGrantId(),
    );
    this.#onChange?.();
    return result;
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
   * 读取请求队列态；用于高风险 action 在写 grant 前复验。
   *
   * @param permissionRequestId 请求 id
   * @returns 队列态；不存在为 null
   */
  getQueueStatus(permissionRequestId: string): PermissionQueueStatus | null {
    return this.#queueStatus.get(permissionRequestId) ?? null;
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
      this.#onChange?.();
    }
    return true;
  }

  /**
   * 非消耗式检查 job 是否持有某权限授予。
   * 用于编排层确认“证据存在”；真实执行前仍应调用 isGranted。
   *
   * @param jobId job id
   * @param permissionId 权限
   * @returns 是否存在有效授予
   */
  hasGrant(jobId: string, permissionId: PermissionId): boolean {
    if (isAllowedByDefault(permissionId)) {
      return true;
    }
    return this.#grants.some(
      (g) => g.active && g.jobId === jobId && g.permissionId === permissionId,
    );
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
  listPendingCards(): PendingPermissionCardView[] { return projectPendingCards(this.#requests, this.#queueStatus); }

  /**
   * 组装可发给 phone 的 permission.decision 载荷字段。
   *
   * @param result 成功的裁决结果
   * @param permissionRequestId 请求 id
   * @param jobId 可选 job
   * @returns payload 或 null
   */
  toDecisionPayload(result: GateDecisionResult, permissionRequestId: string, jobId?: string | null): PermissionDecisionPayload | null { return projectPermissionDecision(result, permissionRequestId, jobId); }

  /**
   * 导出可落盘快照。
   *
   * @returns dump
   */
  dump(): PermissionGateSnapshot { return snapshotPermissionGate(this.#requests, this.#queueStatus, this.#grants, this.#grantSeq); }

  /**
   * 从快照恢复。
   *
   * @param dump 快照
   */
  hydrate(dump: Partial<PermissionGateSnapshot>): void {
    const restored = restorePermissionGate(dump);
    this.#requests = restored.requests;
    this.#queueStatus = restored.queueStatus;
    this.#grants = restored.grants;
    this.#grantSeq = restored.grantSeq;
  }

  /**
   * 事务取消围栏生效后撤销 job 的所有授予和 pending。
   * @param jobId 被取消的 job
   */
  revokeForJob(jobId: string): void {
    this.expirePendingForJob(jobId);
    this.#grants = this.#grants.filter((grant) => grant.jobId !== jobId);
    this.#onChange?.();
  }

  /**
   * 撤销全部授予与待确认（配对 revoke 时调用）。
   */
  revokeAll(): void {
    this.#requests.clear();
    this.#queueStatus.clear();
    this.#grants = [];
    this.#onChange?.();
  }

  /**
   * job 是否仍有 pending 权限请求（并发 job.create 门闩）。
   *
   * @param jobId job id
   * @returns 是否存在 pending
   */
  hasPendingForJob(jobId: string): boolean {
    return pendingRequestIds(this.#requests, this.#queueStatus, (request) => request.jobId === jobId).length > 0;
  }

  /**
   * 列出已裁决且仍持有有效 grant 的请求 id（启动 reconcile 用）。
   *
   * @returns permissionRequestId 列表
   */
  listDecidedGrantableRequestIds(): string[] {
    return grantableRequestIds(this.#requests, this.#queueStatus, (jobId, permission) => this.hasGrant(jobId, permission));
  }

  /**
   * 取消 job 时清除该 job 的 pending 权限请求（若存在）。
   *
   * @param jobId job id
   */
  clearPendingForJob(jobId: string): { expired: string[] } {
    return this.expirePendingForJob(jobId);
  }

  /**
   * job 被取消或父事务终态时，使相关待授权请求失效。
   *
   * @param jobId job id
   * @returns 被失效的 permissionRequestId
   */
  expirePendingForJob(jobId: string): { expired: string[] } {
    const expired: string[] = [];
    for (const [id, request] of this.#requests) {
      if (request.jobId === jobId && this.#queueStatus.get(id) === "pending") {
        this.#queueStatus.set(id, "expired");
        expired.push(id);
      }
    }
    if (expired.length > 0) {
      this.#onChange?.();
    }
    return { expired };
  }

  /**
   * 父事务终态时，使该事务下所有待授权请求失效。
   *
   * @param affairId affair id
   * @returns 被失效的 permissionRequestId
   */
  expirePendingForAffair(affairId: string): { expired: string[] } {
    const expired: string[] = [];
    for (const [id, request] of this.#requests) {
      if (request.affairId === affairId && this.#queueStatus.get(id) === "pending") {
        this.#queueStatus.set(id, "expired");
        expired.push(id);
      }
    }
    if (expired.length > 0) {
      this.#onChange?.();
    }
    return { expired };
  }

  /**
   * @returns 下一 grantId
   */
  #nextGrantId(): string {
    this.#grantSeq += 1;
    return `grant_${this.#grantSeq}_${createPermissionRequestId().slice(5, 13)}`;
  }
}
