/**
 * 演示用 permission gate 工厂。
 *
 * 职责：预置一条待确认请求，供权限页与 gate 单测共用。
 * 不拥有：真实 job 流水线、凭据、OpenClaw。
 * 副作用：仅构造内存 gate；不含 pairingSecret / API key。
 */

import { PermissionGate } from "../permission-gate.js";
import type { GatePermissionRequest } from "../types.js";

/**
 * 构造带演示待确认项的 PermissionGate。
 *
 * @returns 已入队示例请求的 gate
 */
export function createDemoPermissionGate(): PermissionGate {
  const gate = new PermissionGate();
  const request: GatePermissionRequest = {
    permissionRequestId: "perm_req_001",
    jobId: "job_fix_code_001",
    affairId: "affair_fix_code_001",
    requester: "zhang-boss",
    requestedPermissions: ["workspace.write"],
    reason: "当前 job 需要修复测试失败并写入项目文件",
    risk: "medium",
    proposedScope: { workspaceRoot: "F:/workspace/xxx" },
    denyConsequence: "本 job 将停在 needs_permission，不会修改该目录",
    requestedAt: "2026-07-23T00:58:00.000Z",
    expiresAt: null,
  };
  gate.enqueue(request);
  return gate;
}
