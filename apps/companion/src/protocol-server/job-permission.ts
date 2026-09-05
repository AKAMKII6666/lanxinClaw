/**
 * protocol server 的 job permission 入队 helpers。
 *
 * 职责：把 job.create payload 转为 PermissionGate 请求。
 * 不拥有：WS 监听、backend state、adapter 委派。
 * 副作用：仅写入注入的 PermissionGate。
 */

import {
  createPermissionRequestId,
  PERMISSION_IDS,
  type JobPayload,
  type PermissionId,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import type { CompanionProtocolServerOptions } from "./server.js";

const KNOWN_PERMISSION_ID_SET = new Set<string>(PERMISSION_IDS);

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
  const validated = validatePermissions(payload.allowedPermissions ?? []);
  if (!validated.ok) {
    return validated;
  }
  const request = buildRequest(payload, validated.permissions);
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
    denyConsequence: "拒绝授权会让该 job 失败，但不等于删除整件事务。",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  };
}

/**
 * 校验权限 id：含任一未知 id 即整单拒绝，不静默 strip。
 *
 * @param permissions 原始声明
 * @returns 合法权限或错误
 */
export function validatePermissions(permissions: readonly string[]):
  | { ok: true; permissions: PermissionId[] }
  | { ok: false; code: string; message: string; retryable: false } {
  const seen = new Set<string>();
  const known: PermissionId[] = [];
  const unknown: string[] = [];
  for (const item of permissions) {
    const text = String(item || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    if (KNOWN_PERMISSION_ID_SET.has(text)) {
      known.push(text as PermissionId);
    } else {
      unknown.push(text);
    }
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "unknown_permission_ids",
      message: `job.create 含未知 allowedPermissions：${unknown.join(", ")}；未知 id 不得静默丢弃后继续`,
      retryable: false,
    };
  }
  if (known.length === 0) {
    return {
      ok: false,
      code: "job_permissions_required",
      message: "job.create 必须声明至少一个已知 allowedPermissions，空列表不得委派",
      retryable: false,
    };
  }
  return { ok: true, permissions: known };
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
