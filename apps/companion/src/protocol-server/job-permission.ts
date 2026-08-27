/**
 * protocol server 的 job permission 入队 helpers。
 *
 * 职责：把 job.create payload 转为 PermissionGate 请求。
 * 不拥有：WS 监听、backend state、adapter 委派。
 * 副作用：仅写入注入的 PermissionGate。
 */

import {
  createPermissionRequestId,
  type JobPayload,
  type PermissionId,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import type { CompanionProtocolServerOptions } from "./server.js";

/**
 * job.create 先入队 permission gate。
 */
export function enqueueJobPermission(
  options: CompanionProtocolServerOptions,
  envelope: ProtocolEnvelope,
):
  | { ok: true; permissionRequestId: string; request: ReturnType<typeof buildRequest> }
  | { ok: false; code: string; message: string; retryable: false } {
  const payload = envelope.payload as unknown as JobPayload;
  const requestedPermissions = normalizePermissions(payload.allowedPermissions ?? []);
  if (requestedPermissions.length === 0) {
    return {
      ok: false,
      code: "job_permissions_required",
      message: "job.create 必须声明至少一个已知 allowedPermissions，空列表不得委派",
      retryable: false,
    };
  }
  const request = buildRequest(payload, requestedPermissions);
  const enqueued = options.backend.getPermissionGate().enqueue(request);
  if (enqueued.ok) {
    return { ok: true, permissionRequestId: request.permissionRequestId, request };
  }
  return {
    ok: false,
    code: enqueued.code,
    message: enqueued.message,
    retryable: false,
  };
}

/**
 * 组装 gate 请求。
 *
 * @param payload job 载荷
 * @param requestedPermissions 已过滤权限
 * @returns 请求
 */
function buildRequest(
  payload: JobPayload,
  requestedPermissions: PermissionId[],
) {
  return {
    permissionRequestId: payload.permissionRequestId ?? createPermissionRequestId(),
    jobId: payload.jobId,
    affairId: payload.affairId,
    requester: "zhang-boss" as const,
    requestedPermissions,
    reason: payload.goal,
    risk: riskForPermissions(requestedPermissions),
    proposedScope: { ...(payload.workspaceHint ? { workspaceRoot: payload.workspaceHint } : {}) },
    denyConsequence: "job 将停在 needs_permission，不会委派 OpenClaw 执行",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  };
}

/**
 * 过滤权限 id。
 */
function normalizePermissions(permissions: readonly string[]): PermissionId[] {
  return permissions.filter((item): item is PermissionId =>
    [
      "workspace.read",
      "workspace.write",
      "command.run",
      "network.access",
      "git.read",
      "git.write",
      "secrets.read",
      "desktop.control",
    ].includes(item),
  );
}

/**
 * 推断风险等级。
 */
function riskForPermissions(permissions: readonly PermissionId[]): "low" | "medium" | "high" {
  if (permissions.some((item) => item === "secrets.read" || item === "desktop.control")) {
    return "high";
  }
  if (permissions.some((item) => item.endsWith(".write") || item === "command.run" || item === "network.access")) {
    return "medium";
  }
  return "low";
}
