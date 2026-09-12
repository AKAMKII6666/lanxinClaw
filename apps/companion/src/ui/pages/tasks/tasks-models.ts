/**
 * 任务页视图模型。
 *
 * 职责：描述 affair 列表项与详情面板所需字段。
 * 不拥有：协议校验、OpenClaw、权限裁决。
 * 纯函数：仅类型。
 */

/**
 * 左侧列表中的事务摘要。
 */
export interface AffairListItemView {
  /** 事务 id */
  affairId: string;
  /** 列表分组 */
  groupLabel: "处理中" | "已结束";
  /** 标题 */
  title: string;
  /** 事务状态 */
  status: string;
  /** 最近进展摘要 */
  progressSummary: string;
  /** blocked 原因；非 blocked 为 null */
  blockedReason: string | null;
  /** 最近更新时间 */
  updatedAt: string;
}

/**
 * 右侧详情中的当前 job 摘要。
 */
export interface JobDetailView {
  /** job id */
  jobId: string;
  /** worker 状态；completed 不得映射为 affair closed */
  status: string;
  /** 执行者标签 */
  executor: string;
  /** 目标说明 */
  goal: string;
  /** 进展摘要 */
  progressSummary: string;
  /** 已尝试步骤（用户可见） */
  attemptedSteps: string[];
  /** blocked 原因；可空 */
  blockedReason: string | null;
  /** 恢复条件；可空 */
  resumeCondition: string | null;
}

/**
 * 事务脉络时间线条目。
 */
export interface AffairTimelineEntryView {
  /** 条目 id */
  entryId: string;
  /** 发生时间 */
  at: string;
  /** 标签：创建 / progress / blocked / resume / waiting_acceptance / note */
  kind: string;
  /** 用户可见摘要 */
  summary: string;
}

/**
 * 事务详情面板。
 */
export interface AffairDetailView {
  /** 事务 id */
  affairId: string;
  /** 标题 */
  title: string;
  /** 事务状态 */
  status: string;
  /** 负责人展示名 */
  ownerLabel: string;
  /** 完成标准 */
  acceptanceCriteria: string[];
  /** 用户原始描述与已确认上下文 */
  context: string[];
  /** 事务脉络（已尝试与关键节点） */
  timeline: AffairTimelineEntryView[];
  /** 当前 blocker 摘要；非 blocked 为 null */
  blockerSummary: string | null;
  /** 恢复条件；可空 */
  resumeCondition: string | null;
  /** 验收结果摘要；未到验收为 null */
  acceptanceResult: string | null;
  /** 当前 job；无则为 null */
  currentJob: JobDetailView | null;
  /** 最近更新时间 */
  updatedAt: string;
}

/**
 * 任务页工作区：列表 + 可选选中详情。
 */
export interface TaskWorkspaceView {
  /** 事务列表 */
  affairs: AffairListItemView[];
  /** 默认选中的事务 id；列表空时为 null */
  selectedAffairId: string | null;
  /** 选中详情；无选中为 null */
  selectedDetail: AffairDetailView | null;
}
