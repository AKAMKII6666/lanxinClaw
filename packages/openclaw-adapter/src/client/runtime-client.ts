/**
 * OpenClaw runtime 客户端窄接口。
 *
 * 职责：抽象 create/get/cancel run，便于真实 SDK 与 mock 互换。
 * 不拥有：Lanxing job 登记、权限裁决、affair 生命周期。
 * 副作用：真实实现会对 Gateway 产生网络 I/O；mock 仅内存。
 */

import type { OpenClawRunStatus } from "../status/openclaw-run-status.js";

/**
 * 创建 run 的入参；不得包含 API key 明文。
 */
export interface CreateOpenClawRunParams {
  /** 交给 agent 的任务描述（来自 job.goal） */
  input: string;
  /** 工作区提示；可空 */
  workspaceHint?: string | null;
  /** 会话键；建议绑定 jobId 以便取消与诊断 */
  sessionKey?: string;
}

/**
 * Runtime 返回的 run 快照。
 */
export interface OpenClawRunSnapshot {
  /** OpenClaw run id */
  runId: string;
  /** 规范化状态 */
  status: OpenClawRunStatus;
  /** 进度或结果摘要；不得含凭据 */
  summary?: string;
  /** 阻塞原因；可空 */
  blockedReason?: string | null;
  /** 恢复条件；可空 */
  resumeCondition?: string | null;
}

/**
 * 外部 OpenClaw runtime 客户端。
 */
export interface OpenClawRuntimeClient {
  /**
   * 创建一次 agent run。
   *
   * @param params 创建参数
   * @returns 新建 run 的 id 与初始状态
   */
  createRun(params: CreateOpenClawRunParams): Promise<OpenClawRunSnapshot>;

  /**
   * 读取 run 当前状态。
   *
   * @param runId OpenClaw run id
   * @returns 快照；不存在时抛错或由实现约定
   */
  getRun(runId: string): Promise<OpenClawRunSnapshot>;

  /**
   * 请求取消 run；已终态应幂等成功。
   *
   * @param runId OpenClaw run id
   * @returns 取消后的快照
   */
  cancelRun(runId: string): Promise<OpenClawRunSnapshot>;
}
