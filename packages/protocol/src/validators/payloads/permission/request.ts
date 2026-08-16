/**
 * permission.request 校验。
 *
 * 职责：校验 permission.request 与 proposedScope。
 * 不拥有：权限最终授予。
 * 纯函数：无 I/O。
 */

import { PERMISSION_IDS, type PermissionId } from "../../../messages/payloads/core.js";
import type {
  PermissionRequestPayload,
  ProposedScope,
} from "../../../messages/payloads/session.js";
import {
  expectEnum,
  expectNonEmptyString,
  expectObject,
  expectStringOrNull,
  optionalField,
  rejectUnknownKeys,
} from "../../primitives.js";
import type { ValidateResult } from "../../result.js";

/**
 * 校验 proposedScope 对象。
 *
 * @param value 待检值
 * @returns ProposedScope 或失败
 */
function validateProposedScope(value: unknown): ValidateResult<ProposedScope> {
  const obj = expectObject(value, "proposedScope");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    ["workspaceRoot", "commands", "networkHosts"],
    "proposedScope",
  );
  if (!keys.ok) {
    return keys;
  }
  const scope: ProposedScope = {};
  if ("workspaceRoot" in obj.value) {
    const root = expectNonEmptyString(obj.value.workspaceRoot, "workspaceRoot");
    if (!root.ok) {
      return root;
    }
    scope.workspaceRoot = root.value;
  }
  if ("commands" in obj.value) {
    if (!Array.isArray(obj.value.commands)) {
      return {
        ok: false,
        error: { code: "validation_failed", message: "commands 必须是数组", retryable: false },
      };
    }
    const commands: string[] = [];
    for (let i = 0; i < obj.value.commands.length; i += 1) {
      const item = expectNonEmptyString(obj.value.commands[i], `commands[${i}]`);
      if (!item.ok) {
        return item;
      }
      commands.push(item.value);
    }
    scope.commands = commands;
  }
  if ("networkHosts" in obj.value) {
    if (!Array.isArray(obj.value.networkHosts)) {
      return {
        ok: false,
        error: { code: "validation_failed", message: "networkHosts 必须是数组", retryable: false },
      };
    }
    const hosts: string[] = [];
    for (let i = 0; i < obj.value.networkHosts.length; i += 1) {
      const item = expectNonEmptyString(obj.value.networkHosts[i], `networkHosts[${i}]`);
      if (!item.ok) {
        return item;
      }
      hosts.push(item.value);
    }
    scope.networkHosts = hosts;
  }
  return { ok: true, value: scope };
}

/**
 * 校验 permission.request。
 *
 * @param value 待检 payload
 * @returns PermissionRequestPayload 或失败
 */
export function validatePermissionRequestPayload(
  value: unknown,
): ValidateResult<PermissionRequestPayload> {
  const obj = expectObject(value, "permission.request");
  if (!obj.ok) {
    return obj;
  }
  const keys = rejectUnknownKeys(
    obj.value,
    [
      "permissionRequestId",
      "jobId",
      "affairId",
      "requestedPermissions",
      "reason",
      "risk",
      "proposedScope",
    ],
    "permission.request",
  );
  if (!keys.ok) {
    return keys;
  }
  const permissionRequestId = expectNonEmptyString(
    obj.value.permissionRequestId,
    "permissionRequestId",
  );
  if (!permissionRequestId.ok) {
    return permissionRequestId;
  }
  const jobId = expectNonEmptyString(obj.value.jobId, "jobId");
  if (!jobId.ok) {
    return jobId;
  }
  const affairId = optionalField(obj.value, "affairId", (v) => expectStringOrNull(v, "affairId"));
  if (!affairId.ok) {
    return affairId;
  }
  if (!Array.isArray(obj.value.requestedPermissions) || obj.value.requestedPermissions.length < 1) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "requestedPermissions 须为非空数组",
        retryable: false,
      },
    };
  }
  const requestedPermissions: PermissionId[] = [];
  for (let i = 0; i < obj.value.requestedPermissions.length; i += 1) {
    const item = expectEnum(
      obj.value.requestedPermissions[i],
      `requestedPermissions[${i}]`,
      PERMISSION_IDS,
    );
    if (!item.ok) {
      return item;
    }
    requestedPermissions.push(item.value);
  }
  const reason = expectNonEmptyString(obj.value.reason, "reason");
  if (!reason.ok) {
    return reason;
  }
  const risk = expectEnum(obj.value.risk, "risk", ["low", "medium", "high"] as const);
  if (!risk.ok) {
    return risk;
  }
  const proposedScope = validateProposedScope(obj.value.proposedScope);
  if (!proposedScope.ok) {
    return proposedScope;
  }
  const payload: PermissionRequestPayload = {
    permissionRequestId: permissionRequestId.value,
    jobId: jobId.value,
    requestedPermissions,
    reason: reason.value,
    risk: risk.value,
    proposedScope: proposedScope.value,
  };
  if (affairId.value !== undefined) {
    payload.affairId = affairId.value;
  }
  return { ok: true, value: payload };
}
