/**
 * Adapter job 入参与登记记录类型。
 *
 * 职责：描述 create/read/cancel API 的输入输出形状。
 * 不拥有：OpenClaw Gateway 连接、pairing、affair 关闭。
 * 纯函数：仅类型定义。
 */

import type { JobStatus } from "@lanxin-claw/protocol";

/**
 * 创建 adapter job 的显式入参。
 * companion 必须先完成权限门；本结构携带已允许权限，不接收凭据。
 */
export interface CreateAdapterJobInput {
  /** 与协议 jobId 对齐的稳定 id；重试须幂等 */
  jobId: string;
  /** 所属 affairId；仅用于关联，不关闭事务 */
  affairId: string;
  /** 执行目标摘要；不得含 API key 或私钥 */
  goal: string;
  /** 工作区提示路径；可空，非授权本身 */
  workspaceHint?: string | null;
  /** companion 已裁决允许的权限 id 列表；不得为空数组时静默抬权 */
  allowedPermissions: readonly string[];
}

/**
 * Adapter 侧 job 登记快照；completed 只表示 worker 完成。
 */
export interface AdapterJobRecord {
  /** 与协议对齐的 jobId */
  jobId: string;
  /** 所属 affairId */
  affairId: string;
  /** 映射后的 Lanxing job 状态 */
  status: JobStatus;
  /** 执行目标摘要 */
  goal: string;
  /** 工作区提示；可空 */
  workspaceHint?: string | null;
  /** 已声明允许权限 */
  allowedPermissions: readonly string[];
  /** OpenClaw run id；创建成功后有值 */
  openclawRunId: string | null;
  /** 进度摘要；安全文本，不含凭据 */
  progressSummary: string;
  /** 阻塞原因；无阻塞时为 null */
  blockedReason: string | null;
  /** 恢复条件；无阻塞时为 null */
  resumeCondition: string | null;
  /** 最近一次从 runtime 观察到的原始 run 状态标签 */
  lastRunStatus: string | null;
}

/**
 * create/read/cancel 的结果包装。
 */
export type AdapterJobResult =
  | { ok: true; job: AdapterJobRecord }
  | { ok: false; code: string; message: string; retryable: boolean };
