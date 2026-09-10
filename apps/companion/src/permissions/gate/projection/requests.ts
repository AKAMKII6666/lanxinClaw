/**
 * 权限请求查询。
 * 职责：筛选 pending 与可恢复的已裁决请求；不拥有裁决和授予写入。
 * 纯函数：只读传入的队列与授权查询端口。
 */
import type { PermissionId } from "@lanxin-claw/protocol";
import type { GatePermissionRequest, PermissionQueueStatus } from "../types.js";

/**
 * @param requests 请求表
 * @param statuses 队列态
 * @param matches 对象选择器
 * @returns 匹配的待授权请求 ID
 */
export function pendingRequestIds(requests: ReadonlyMap<string, GatePermissionRequest>,
  statuses: ReadonlyMap<string, PermissionQueueStatus>, matches: (request: GatePermissionRequest) => boolean): string[] {
  return [...requests].filter(([id, request]) => statuses.get(id) === "pending" && matches(request)).map(([id]) => id);
}

/**
 * @param requests 请求表
 * @param statuses 队列态
 * @param hasGrant 不消耗授予的查询
 * @param permission 回调读取的已声明权限
 * @returns 重启时可恢复的请求 ID
 */
export function grantableRequestIds(requests: ReadonlyMap<string, GatePermissionRequest>,
  statuses: ReadonlyMap<string, PermissionQueueStatus>, hasGrant: (jobId: string, permission: PermissionId) => boolean): string[] {
  return [...requests].filter(([id, request]) => statuses.get(id) === "decided" && request.jobId &&
    request.requestedPermissions.every((permission) => hasGrant(request.jobId!, permission as PermissionId))).map(([id]) => id);
}
