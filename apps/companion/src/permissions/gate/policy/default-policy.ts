/**
 * 权限默认策略（对照安全模型）。
 *
 * 职责：把 permission id 分到 default_allow / needs_confirm / default_deny。
 * 不拥有：用户确认 UI、实际授予落库、OpenClaw。
 * 纯函数：无 I/O。
 */

import { PERMISSION_IDS, type PermissionId } from "@lanxin-claw/protocol";
import type { PermissionPolicyBucket } from "../types.js";

/** 未授权时默认拒绝的高风险权限 */
const DEFAULT_DENY = new Set<PermissionId>(["secrets.read", "desktop.control"]);

/** 元能力：查看连接/能力摘要；不在执行 permission id 表内时视为允许 */
const META_ALLOW_LABELS = new Set(["connection.status", "companion.capability_summary"]);

/**
 * 解析 permission id 的默认策略桶。
 *
 * @param permissionId 权限 id 或元能力标签
 * @returns 策略桶
 */
export function classifyPermissionPolicy(permissionId: string): PermissionPolicyBucket {
  if (META_ALLOW_LABELS.has(permissionId)) {
    return "default_allow";
  }
  if (!isKnownPermissionId(permissionId)) {
    return "default_deny";
  }
  if (DEFAULT_DENY.has(permissionId)) {
    return "default_deny";
  }
  return "needs_confirm";
}

/**
 * 未授予时是否允许执行。
 * default_allow 才为 true；其余必须等 gate 授予。
 *
 * @param permissionId 权限 id
 * @returns 是否默认可执行
 */
export function isAllowedByDefault(permissionId: string): boolean {
  return classifyPermissionPolicy(permissionId) === "default_allow";
}

/**
 * 是否已知协议 permission id。
 *
 * @param value 候选
 * @returns 是否属于 PERMISSION_IDS
 */
export function isKnownPermissionId(value: string): value is PermissionId {
  return (PERMISSION_IDS as readonly string[]).includes(value);
}
