/**
 * JobDelegator 上下文投影辅助。
 *
 * 职责：从依赖与 permission request 构造出站身份和失败上下文。
 * 不拥有：状态迁移、权限裁决、协议发送。
 * 纯函数：无 I/O。
 */

import type { GatePermissionRequest } from "../../permissions/gate/types.js";
import type {
  DelegationFailureContext,
  DelegatorEnvelopeIdentity,
} from "./projection/delegator-outbound.js";
import type { JobDelegatorDeps } from "./delegator-types.js";

/**
 * 构造 companion -> phone envelope 身份。
 *
 * @param deps 委派器依赖
 * @returns 出站身份
 */
export function outboundIdentityFromDeps(
  deps: Pick<JobDelegatorDeps, "desktopDeviceId" | "getPhoneDeviceId">,
): DelegatorEnvelopeIdentity {
  return {
    desktopDeviceId: deps.desktopDeviceId,
    phoneDeviceId: deps.getPhoneDeviceId() ?? "unknown",
  };
}

/**
 * 保留委派失败时的原始 job 上下文。
 *
 * @param deps 委派器依赖
 * @param request 权限请求
 * @param workspaceHint 已归一化工作区提示
 * @returns 失败投影上下文
 */
export function failureContextForRequest(
  deps: Pick<JobDelegatorDeps, "getJobPurpose">,
  request: GatePermissionRequest,
  workspaceHint?: string | null,
): DelegationFailureContext {
  return {
    goal: request.reason,
    purpose: deps.getJobPurpose?.(request.jobId) ?? "execution",
    workspaceHint: workspaceHint ?? request.proposedScope.workspaceRoot ?? null,
    allowedPermissions: request.requestedPermissions,
  };
}
