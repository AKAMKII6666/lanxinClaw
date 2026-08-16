/**
 * 为低风险 job 入队 permission.request（companion 权威侧）。
 *
 * 职责：按任务种类生成待确认请求；不执行副作用。
 * 不拥有：用户裁决 UI、adapter 执行、affair 关闭。
 * 副作用：写入 PermissionGate 内存队列。
 */

import {
  createPermissionRequestId,
  type PermissionId,
} from "@lanxin-claw/protocol";
import {
  requiredPermissionsForLowRisk,
  type LowRiskTaskKind,
} from "@lanxin-claw/openclaw-adapter";
import type { PermissionGate } from "../permissions/gate/permission-gate.js";
import type { GatePermissionRequest } from "../permissions/gate/types.js";

/**
 * 入队参数。
 */
export interface EnqueueLowRiskPermissionInput {
  /** 关联 job */
  jobId: string;
  /** 关联 affair；可空 */
  affairId: string | null;
  /** 白名单任务 */
  kind: LowRiskTaskKind;
  /** 可选工作区根写入 proposedScope */
  workspaceRoot?: string | null;
  /** 可选固定 permissionRequestId；默认新建 */
  permissionRequestId?: string;
}

/**
 * 将低风险任务所需权限入队，供桌面确认。
 *
 * @param gate permission gate
 * @param input 任务与 id
 * @returns 入队的 permissionRequestId 或错误
 */
export function enqueueLowRiskPermission(
  gate: PermissionGate,
  input: EnqueueLowRiskPermissionInput,
): { ok: true; permissionRequestId: string } | { ok: false; code: string; message: string } {
  const permissionRequestId = input.permissionRequestId ?? createPermissionRequestId();
  const requestedPermissions = requiredPermissionsForLowRisk(input.kind) as PermissionId[];
  const request: GatePermissionRequest = {
    permissionRequestId,
    jobId: input.jobId,
    affairId: input.affairId,
    requester: "openclaw-adapter",
    requestedPermissions,
    reason: `低风险只读任务 ${input.kind}`,
    risk: "low",
    proposedScope: buildProposedScope(input.workspaceRoot),
    denyConsequence: "job 停在 needs_permission，不执行本机检查",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  };
  const enqueued = gate.enqueue(request);
  if (!enqueued.ok) {
    return enqueued;
  }
  return { ok: true, permissionRequestId };
}

/**
 * @param workspaceRoot 可选工作区根
 * @returns proposedScope
 */
function buildProposedScope(workspaceRoot?: string | null) {
  if (workspaceRoot && workspaceRoot.trim()) {
    return { workspaceRoot };
  }
  return {};
}
