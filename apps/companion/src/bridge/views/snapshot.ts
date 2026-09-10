/** 控制面板只读快照契约；不包含凭据明文或副作用能力。 */
import type { BridgeActionDelivery } from "../contract.js";

/**
 * Companion 服务状态卡。
 */
export interface CompanionStatusView {
  /** 运行状态枚举 */
  status: string;
  /** 版本；可空 */
  version: string | null;
  /** 已运行毫秒；未运行可空 */
  uptimeMs: number | null;
  /** 用户可见短说明；可空 */
  message: string | null;
}

/**
 * OpenClaw / worker 状态卡。
 */
export interface ClawCoreStatusView {
  /** worker 运行状态 */
  status: string;
  /** 检测到的版本；可空 */
  version: string | null;
  /** adapter 是否可接 job */
  adapterReady: boolean;
  /** 用户可见短说明；可空 */
  message: string | null;
}

/**
 * 凭据配置态；不得含明文。
 */
export interface CredentialStatusView {
  /** 配置态枚举 */
  status: string;
  /** 用途标签，不是 key 原文 */
  provider: string;
  /** 最近同步时间；可空 */
  lastSyncedAt: string | null;
  /** 过期时间；可空 */
  expiresAt: string | null;
  /** 用户可见短说明；可空 */
  message: string | null;
}

/**
 * 澜星电话连接摘要。
 */
export interface DeviceStatusView {
  /** 发现/连接状态；discovered ≠ 已授权 */
  status: string;
  /** 电话设备 id；可空 */
  phoneDeviceId: string | null;
  /** 展示名；可空 */
  phoneDisplayName: string | null;
  /** 配对 id；可空 */
  pairingId: string | null;
  /** 会话 id；可空 */
  sessionId: string | null;
  /** 截断指纹提示；可空 */
  fingerprintHint: string | null;
  /** 最近可见时间；可空 */
  lastSeenAt: string | null;
  /** 用户可见短说明；可空 */
  message: string | null;
}

/**
 * 张老板在线与监督摘要。
 */
export interface ZhangBossStatusView {
  /** 在线/监督状态 */
  status: string;
  /** 正在盯的事务 id；可空 */
  activeAffairId: string | null;
  /** 当前通话 id；可空 */
  activeCallId: string | null;
  /** 一句话摘要；可空 */
  summary: string | null;
}

/**
 * 当前优先事务摘要；worker completed 不得写成 closed。
 */
export interface CurrentAffairSummaryView {
  /** 事务 id */
  affairId: string;
  /** 标题 */
  title: string;
  /** 事务状态 */
  status: string;
  /** 当前 job id；可空 */
  currentJobId: string | null;
  /** 当前 job 状态；可空；用于区分 delegated 与 needs_permission */
  currentJobStatus?: string | null;
  /** 当前 job 目标；可空 */
  currentJobGoal?: string | null;
  /** 当前 job 最近进展；可空 */
  currentJobProgressSummary?: string | null;
  /** 当前 job 阻塞原因；可空 */
  currentJobBlockedReason?: string | null;
  /** 当前 job 恢复条件；可空 */
  currentJobResumeCondition?: string | null;
  /** 当前 job 状态理由码；可空 */
  currentJobStatusReasonCode?: string | null;
  /** 当前 job 状态观测时间；可空 */
  currentJobStatusObservedAt?: string | null;
  /** 执行者标签；可空 */
  executor: string | null;
  /** 用户给出的上下文；非系统指令 */
  context: string[];
  /** 事务验收标准 */
  acceptanceCriteria: string[];
  /** 最近进展 */
  progressSummary: string;
  /** 阻塞原因；非 blocked 为 null */
  blockedReason: string | null;
  /** 恢复条件；可空 */
  resumeCondition: string | null;
  /** 最近更新时间 */
  updatedAt: string;
}

/**
 * 总览 snapshot 视图（与控制面板契约对齐）。
 */
export interface ControlPanelSnapshotView {
  /** 契约版本 */
  schemaVersion: string;
  /** 快照 id */
  snapshotId: string;
  /** 生成时间 */
  generatedAt: string;
  /** companion 自身 */
  companion: CompanionStatusView;
  /** OpenClaw / worker */
  clawCore: ClawCoreStatusView;
  /** 凭据配置态 */
  credential: CredentialStatusView;
  /** 电话连接 */
  device: DeviceStatusView;
  /** 张老板 */
  zhangBoss: ZhangBossStatusView;
  /** 当前事务；无则为 null */
  currentAffair: CurrentAffairSummaryView | null;
  /** 处理中事务 + 最近终态事务摘要；旧 renderer 可忽略 */
  affairs?: CurrentAffairSummaryView[];
  /** 精确文本侧写；可空（旧 snapshot 可无此字段） */
  sideChannel?: SnapshotSideChannelView;
  /** 最近 UI action 投递回执；旧 renderer 可忽略 */
  recentActionDeliveries?: BridgeActionDelivery[];
}

/**
 * snapshot 侧写消息；text 视为 untrusted。
 */
export interface SnapshotSideChannelMessageView {
  /** 协议 chatMessageId */
  messageId: string;
  /** 作者种类 */
  authorKind: string;
  /** 正文；untrusted */
  text: string;
  /** 发送时间 */
  sentAt: string;
}

/**
 * snapshot 侧写附件。
 */
export interface SnapshotSideChannelAttachView {
  /** attachId */
  attachId: string;
  /** 附加文本；untrusted */
  text: string;
  /** 内容种类 */
  contentKind: string;
  /** 目标标签 */
  targetLabel: string;
  /** 投递通道标签 */
  deliveryLabel: string;
  /** 附加时间 */
  attachedAt: string;
}

/**
 * 精确文本与 pending 队列摘要。
 */
export interface SnapshotSideChannelView {
  /** 待张老板 FC 消费的条数 */
  pendingContextCount: number;
  /** 线程消息 */
  messages: SnapshotSideChannelMessageView[];
  /** 附加历史 */
  attachments: SnapshotSideChannelAttachView[];
}
