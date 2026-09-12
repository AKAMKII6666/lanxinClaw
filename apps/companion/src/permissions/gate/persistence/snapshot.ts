/**
 * 权限 gate 的持久化投影。
 * 职责：复制请求与授予快照。不拥有：权限裁决或磁盘读写。纯函数，无 I/O。
 */
import type { GatePermissionRequest, PermissionGrantRecord, PermissionQueueStatus } from "../types.js";

/** 可持久化的权限门闩。 */
export interface PermissionGateSnapshot {
  /** 请求清单。 */
  requests: GatePermissionRequest[];
  /** 各请求的阶段。 */
  queueStatus: Array<[string, PermissionQueueStatus]>;
  /** 授予记录。 */
  grants: PermissionGrantRecord[];
  /** 授予 ID 序列。 */
  grantSeq: number;
}

/**
 * 生成独立的持久化副本。
 * @param requests 当前请求
 * @param queueStatus 当前请求阶段
 * @param grants 当前授予
 * @param grantSeq ID 序列
 * @returns 脱离可变数组的快照
 */
export function snapshotPermissionGate(requests: ReadonlyMap<string, GatePermissionRequest>, queueStatus: ReadonlyMap<string, PermissionQueueStatus>, grants: readonly PermissionGrantRecord[], grantSeq: number): PermissionGateSnapshot {
  return { requests: [...requests.values()].map((item) => ({ ...item, requestedPermissions: [...item.requestedPermissions], proposedScope: { ...item.proposedScope } })),
    queueStatus: [...queueStatus.entries()], grants: grants.map((item) => ({ ...item })), grantSeq };
}

/**
 * 恢复旧快照可缺省的字段。
 * @param dump 持久化快照
 * @returns 内存集合；不创建额外授予
 */
export function restorePermissionGate(dump: Partial<PermissionGateSnapshot>) {
  return { requests: new Map((dump.requests ?? []).map((item) => [item.permissionRequestId, item])),
    queueStatus: new Map(dump.queueStatus ?? []), grants: (dump.grants ?? []).map((item) => ({ ...item })), grantSeq: dump.grantSeq ?? 0 };
}
