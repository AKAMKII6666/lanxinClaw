/**
 * 经 permission gate 委派低风险只读 job 到 OpenClaw adapter。
 *
 * 职责：确认用户授权 → 调用 adapter create/read → 回传 job 状态；明确不关闭 affair。
 * 不拥有：renderer IPC、真实 Gateway、pairing、凭据明文、affair 验收关闭。
 * 副作用：消耗 gate 授予；调用 runtime（本机只读 fs/git 或 mock）。
 */

import {
  OpenClawAdapter,
  buildLowRiskGoal,
  requiredPermissionsForLowRisk,
  type LowRiskTaskKind,
} from "@lanxin-claw/openclaw-adapter";
import type { AffairStatus, PermissionId } from "@lanxin-claw/protocol";
import type { PermissionGate } from "../permissions/gate/permission-gate.js";
import type {
  RunLowRiskJobFailure,
  RunLowRiskJobInput,
  RunLowRiskJobSuccess,
} from "./types.js";
import { resolveAuthorizedWorkspaceRoot } from "./workspace-scope.js";

/**
 * 编排依赖。
 */
export interface LowRiskJobRunnerDeps {
  /** 桌面权限权威 */
  gate: PermissionGate;
  /** 已注入 runtime 的 adapter */
  adapter: OpenClawAdapter;
  /**
   * 调用前 affair 状态；本函数不得改写。
   * 用于证明 job.completed ≠ affair.closed。
   */
  affairStatus: AffairStatus;
}

/**
 * 在 companion 边界内跑通一个低风险只读任务。
 *
 * @param deps gate 与 adapter
 * @param input job / 权限 / 任务种类
 * @returns 成功含 job；失败含稳定码
 */
export async function runLowRiskJob(
  deps: LowRiskJobRunnerDeps,
  input: RunLowRiskJobInput,
): Promise<RunLowRiskJobSuccess | RunLowRiskJobFailure> {
  const decision = input.permissionDecision ?? "allow_for_job";
  const decided = deps.gate.decide(input.permissionRequestId, decision);
  if (!decided.ok) {
    return {
      ok: false,
      code: decided.code ?? "permission_decide_failed",
      message: decided.message ?? "权限裁决失败",
    };
  }
  if (decided.actionBlocked) {
    return {
      ok: false,
      code: "permission_blocked",
      message: "权限未授予或需更多上下文，拒绝委派 adapter",
    };
  }

  const required = requiredPermissionsForLowRisk(input.kind);
  for (const permissionId of required) {
    if (!deps.gate.isGranted(input.jobId, permissionId as PermissionId)) {
      return {
        ok: false,
        code: "permission_not_granted",
        message: `缺少已授予权限: ${permissionId}`,
      };
    }
  }

  const scopedRoot = resolveJobWorkspaceRoot(deps.gate, input);
  if (!scopedRoot.ok) {
    return scopedRoot;
  }

  const goal = buildLowRiskGoal(input.kind, describeKind(input.kind));
  const created = await deps.adapter.createJob({
    jobId: input.jobId,
    affairId: input.affairId,
    goal,
    workspaceHint: scopedRoot.workspaceRoot,
    allowedPermissions: [...required],
  });
  if (!created.ok) {
    return {
      ok: false,
      code: created.code,
      message: created.message,
    };
  }

  const refreshed = await deps.adapter.readJob(input.jobId, { refresh: true });
  if (!refreshed.ok) {
    return {
      ok: false,
      code: refreshed.code,
      message: refreshed.message,
    };
  }

  // 硬约束：本层绝不把 affair 标为 closed；仅回传调用方给定状态。
  return {
    ok: true,
    job: refreshed.job,
    affairStatusAfter: deps.affairStatus,
  };
}

/**
 * 将执行根绑定到 permission.request 的 proposedScope.workspaceRoot（若有）。
 *
 * @param gate permission gate
 * @param input 编排入参
 * @returns 授权范围内的绝对根，或失败
 */
function resolveJobWorkspaceRoot(
  gate: PermissionGate,
  input: RunLowRiskJobInput,
): { ok: true; workspaceRoot: string | null } | RunLowRiskJobFailure {
  const request = gate.getRequest(input.permissionRequestId);
  return resolveAuthorizedWorkspaceRoot(
    request?.proposedScope.workspaceRoot,
    input.workspaceRoot,
  );
}

/**
 * @param kind 任务种类
 * @returns 人类可读摘要
 */
function describeKind(kind: LowRiskTaskKind): string {
  switch (kind) {
    case "workspace.list_root":
      return "只读列出工作区根目录";
    case "git.status":
      return "只读 git status";
    default: {
      const _exhaustive: never = kind;
      return String(_exhaustive);
    }
  }
}
