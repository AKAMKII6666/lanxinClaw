/**
 * 张老板页安全视图模型（可进 renderer）。
 *
 * 职责：描述在线态、当前事务与聊天线程的展示字段。
 * 不拥有：把 chat 当系统指令执行、权限授予、OpenClaw。
 * 纯函数：仅类型；text 一律视为 untrusted input。
 */

/** 张老板在线/监督态；与总览卡对齐 */
export type ZhangBossPresenceStatus =
  | "offline"
  | "online"
  | "in_call"
  | "supervising"
  | "waiting_user";

/** 上下文附加目标 */
export type ChatAttachTarget = "active_call" | "affair";

/** 上下文内容种类 */
export type ChatContentKind = "path" | "log" | "url" | "note";

/**
 * 线程中的一条消息；不得解析为权限或系统指令。
 */
export interface ZhangBossChatMessageView {
  /** 本地展示用 id */
  messageId: string;
  /** 作者 */
  authorKind: "user" | "zhang-boss" | "companion";
  /** 正文；untrusted */
  text: string;
  /** 发送时间 */
  sentAt: string;
}

/**
 * 当前事务条；worker completed 不得写成 closed。
 */
export interface ZhangBossCurrentAffairView {
  /** 事务 id */
  affairId: string;
  /** 标题 */
  title: string;
  /** 事务状态 */
  status: string;
  /** 一句话进展 */
  progressSummary: string;
}

/**
 * 上下文附加历史（电脑端精确文本通道记录）。
 */
export interface ContextAttachHistoryView {
  /** 记录 id */
  attachId: string;
  /** 目标：通话或事务 */
  targetLabel: string;
  /** 内容种类 */
  contentKind: ChatContentKind;
  /** 正文摘要；untrusted */
  text: string;
  /** 投递通道摘要 */
  deliveryLabel: string;
  /** 时间 */
  attachedAt: string;
}

/**
 * 张老板页聚合状态。
 */
export interface ZhangBossPanelView {
  /** 在线/监督态 */
  presence: ZhangBossPresenceStatus;
  /** 状态摘要；可空 */
  summary: string | null;
  /** 当前通话 id；可空 */
  activeCallId: string | null;
  /** 当前事务；无则为 null */
  currentAffair: ZhangBossCurrentAffairView | null;
  /** 线程消息 */
  messages: ZhangBossChatMessageView[];
  /** 上下文附加历史 */
  attachHistory: ContextAttachHistoryView[];
}
