/**
 * 权限页演示状态（permission gate 未闭环前的安全占位）。
 *
 * 职责：提供 paired devices、job permission、待确认卡片样例。
 * 不拥有：真实 gate、identity 持久化、凭据读写。
 * 纯函数：返回静态结构；不含 pairingSecret / API key。
 */

import type { PermissionPanelView } from "./views.js";

/**
 * 构造权限页演示面板数据。
 *
 * @returns 可渲染且无秘密的面板视图
 */
export function createDemoPermissionPanel(): PermissionPanelView {
  return {
    pairedDevices: [
      {
        pairingId: "pair_001",
        phoneDeviceId: "phone_lanxing_001",
        phoneDisplayName: "澜星电话 LxPhone-01",
        desktopDeviceId: "desktop_liao_pc",
        connectionLabel: "已连接",
        fingerprintHint: "8F:2A:…",
        canRevoke: true,
      },
    ],
    currentJobId: "job_fix_code_001",
    jobPermissions: [
      {
        permissionId: "workspace.read",
        scopeSummary: "F:/workspace/xxx",
        grantStatus: "allowed",
      },
      {
        permissionId: "workspace.write",
        scopeSummary: "F:/workspace/xxx",
        grantStatus: "pending",
      },
      {
        permissionId: "command.run",
        scopeSummary: "npm test",
        grantStatus: "allowed",
      },
      {
        permissionId: "network.access",
        scopeSummary: "npm registry",
        grantStatus: "needs_confirm",
      },
    ],
    pendingCards: [
      {
        permissionRequestId: "perm_req_001",
        requester: "zhang-boss",
        affairId: "affair_fix_code_001",
        jobId: "job_fix_code_001",
        reason: "当前 job 需要修复测试失败并写入项目文件",
        risk: "medium",
        scopeSummary: "workspace.write · F:/workspace/xxx",
        denyConsequence: "本 job 将停在 needs_permission，不会修改该目录",
        availableDecisions: ["allow_once", "allow_for_job", "deny", "require_more_context"],
      },
    ],
    auditRecords: [
      {
        auditId: "audit_demo_001",
        kindLabel: "配对",
        at: "2026-07-23T00:10:00.000Z",
        summary: "电话 LxPhone-01 与本机完成双确认配对",
        outcome: "completed",
      },
      {
        auditId: "audit_demo_002",
        kindLabel: "权限",
        at: "2026-07-23T00:58:00.000Z",
        summary: "job_fix_code_001 请求 workspace.write · 待确认",
        outcome: "pending",
      },
      {
        auditId: "audit_demo_003",
        kindLabel: "Job",
        at: "2026-07-23T00:59:00.000Z",
        summary: "低风险只读检查已委派 adapter（非 affair 关闭）",
        outcome: "running",
      },
    ],
  };
}
