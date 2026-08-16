/**
 * Companion 低风险 job 编排类型。
 *
 * 职责：描述经 permission gate 后委派 adapter 的入参与结果。
 * 不拥有：IPC、OpenClaw Gateway、affair 用户验收关闭。
 * 纯函数：仅类型。
 */

import type { AdapterJobRecord, LowRiskTaskKind } from "@lanxin-claw/openclaw-adapter";
import type { AffairStatus } from "@lanxin-claw/protocol";

/**
 * 跑通低风险任务的入参。
 */
export interface RunLowRiskJobInput {
  /** 稳定 jobId；重试须幂等 */
  jobId: string;
  /** 所属 affairId；仅关联，不得因 worker 完成而关闭 */
  affairId: string;
  /** 白名单任务种类 */
  kind: LowRiskTaskKind;
  /** 工作区根；可空则用 runtime 默认 */
  workspaceRoot?: string | null;
  /** 权限请求 id；须已入队 */
  permissionRequestId: string;
  /** 用户对权限请求的决策；默认 allow_for_job */
  permissionDecision?: "allow_once" | "allow_for_job" | "deny" | "require_more_context";
}

/**
 * 低风险编排成功结果。
 * affairStatusAfter 必须仍为调用方给定的非 closed 状态，证明未把 job completed 映射为 affair closed。
 */
export interface RunLowRiskJobSuccess {
  /** 成功 */
  ok: true;
  /** adapter 登记快照 */
  job: AdapterJobRecord;
  /** 编排前后 affair 状态（本层不修改；仅回传断言用） */
  affairStatusAfter: AffairStatus;
}

/**
 * 低风险编排失败。
 */
export interface RunLowRiskJobFailure {
  /** 失败 */
  ok: false;
  /** 稳定错误码 */
  code: string;
  /** 说明；不得含凭据 */
  message: string;
}
