/**
 * 后台监督 loop 的输入输出契约。
 *
 * 职责：描述一次监督 tick 所需的 affair/job 快照与产出动作。
 * 不拥有：OpenClaw 执行、权限授予、affair 关闭权威、电话开麦。
 * 纯函数：仅类型。
 */

/** 监督关注的事务态；终态不进入 tick */
export type SupervisedAffairStatus =
  | "ready"
  | "running"
  | "delegated"
  | "blocked"
  | "paused"
  | "waiting_acceptance"
  | "closed"
  | "canceled";

/** 监督关注的 worker 态；completed 不得视为 affair closed */
export type SupervisedJobStatus =
  | "queued"
  | "accepted"
  | "running"
  | "blocked"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

/**
 * 一次监督观测到的事务 + job 快照。
 */
export interface SupervisionSnapshot {
  /** 事务 id */
  affairId: string;
  /** 标题（用于文案） */
  affairTitle: string;
  /** 事务态 */
  affairStatus: SupervisedAffairStatus;
  /** 当前 job id；无则为 null */
  jobId: string | null;
  /** worker 态；无 job 为 null */
  jobStatus: SupervisedJobStatus | null;
  /** 进展摘要 */
  progressSummary: string;
  /** 已尝试步骤 */
  attemptedSteps: string[];
  /** blocked 原因；可空 */
  blockedReason: string | null;
  /** 恢复条件；可空 */
  resumeCondition: string | null;
  /** 观测时间 */
  observedAt: string;
}

/**
 * 监督 tick 建议的动作；由编排层执行协议/UI，本模块不发网。
 */
export type SupervisionAction =
  | {
      /** 进入 waiting_acceptance；不得 closed */
      kind: "mark_waiting_acceptance";
      affairId: string;
      jobId: string;
      reason: string;
    }
  | {
      /** 同步 blocked 事实到事务簿 */
      kind: "mark_blocked";
      affairId: string;
      jobId: string;
      blockedReason: string;
      resumeCondition: string;
    }
  | {
      /** 低打扰阻塞通知（通话或文字由电话侧决定） */
      kind: "notify_blocked";
      affairId: string;
      title: string;
      body: string;
      fingerprint: string;
    }
  | {
      /** 继续轮询/订阅；无用户打扰 */
      kind: "continue_watch";
      affairId: string;
      note: string;
    }
  | {
      /** 监督结束（终态或无需盯） */
      kind: "stop_watch";
      affairId: string;
      reason: string;
    };

/**
 * 上次已发阻塞通知的指纹，用于抑制重复打扰。
 */
export interface SupervisionNotifyMemory {
  /** affairId → 上次通知指纹 */
  lastBlockedFingerprintByAffair: Map<string, string>;
}
