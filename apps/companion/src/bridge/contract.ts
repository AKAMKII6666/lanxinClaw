/**
 * Renderer ↔ companion backend 的安全 bridge 契约。
 *
 * 职责：定义 IPC 通道名、可提交的 UI 操作、错误回传形状。
 * 不拥有：权限裁决权威（由 host 持有 gate）、凭据明文、文件系统/命令执行、OpenClaw 运行。
 * 纯函数：仅常量与类型；无 I/O。
 */

import type { PendingPermissionCardView } from "../permissions/views.js";

/** 允许暴露给 renderer 的 IPC 通道；禁止扩到任意 Node API。 */
export const BRIDGE_CHANNELS = {
  /** 拉取当前总览 snapshot */
  getSnapshot: "lanxin:bridge:getSnapshot",
  /** 推送 snapshot 更新（main → renderer） */
  snapshotUpdated: "lanxin:bridge:snapshotUpdated",
  /** 提交用户操作意图 */
  submitAction: "lanxin:bridge:submitAction",
  /** renderer 上报展示层错误 */
  reportError: "lanxin:bridge:reportError",
  /** 拉取待确认权限卡片（只读；授予权威在 host gate） */
  listPendingPermissions: "lanxin:bridge:listPendingPermissions",
  /** 拉取诊断报告（只读；不含凭据明文） */
  getDiagnosticReport: "lanxin:bridge:getDiagnosticReport",
  /** renderer 上报日志（只读；仅允许 ui 模块，写入 pino） */
  log: "lanxin:bridge:log",
  /** 拉取 onboarding 状态 */
  onboardingStatus: "lanxin:bridge:onboardingStatus",
  /** 提交 onboarding 配置并执行探针 */
  onboardingSubmit: "lanxin:bridge:onboardingSubmit",
  /** 已配置冷启动：拉起运行时并探针 */
  onboardingBootstrapRuntime: "lanxin:bridge:onboardingBootstrapRuntime",
  /** 清除 onboarding 配置 */
  onboardingClear: "lanxin:bridge:onboardingClear",
  /** 提交/冷启动阶段进度（main → renderer） */
  onboardingProgress: "lanxin:bridge:onboardingProgress",
} as const;

/** onboarding 提交阶段 */
export type OnboardingPhase = "verifying_key" | "starting_runtime";

/** renderer 可上报的日志级别 */
export const RENDERER_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

/** renderer 日志级别 */
export type RendererLogLevel = (typeof RENDERER_LOG_LEVELS)[number];

/** renderer 日志 message 最大长度 */
export const RENDERER_LOG_MAX_MESSAGE_LENGTH = 2000;

/** renderer 日志 meta 最大序列化深度 */
export const RENDERER_LOG_MAX_META_DEPTH = 3;

/**
 * Renderer 上报的日志条目。
 * 仅允许 module="ui"，防止伪造其它模块日志；message 视为 untrusted 文本。
 */
export interface RendererLogEntry {
  /** 固定为 ui */
  module: "ui";
  /** 日志级别 */
  level: RendererLogLevel;
  /** 短说明；不得粘贴凭据 */
  message: string;
  /** 可选结构化元数据；深度受限 */
  meta?: unknown;
}

/** renderer 可见的 onboarding 状态 */
export interface OnboardingStatusView {
  /** 状态 */
  status: "unconfigured" | "configuring" | "ready" | "failed";
  /** 最近失败原因；可空 */
  lastError: { code: string; message: string } | null;
}

/** renderer 提交的 onboarding 配置 */
export interface OnboardingSubmitPayload {
  /** provider 标识 */
  provider: "qwen" | "openai" | "anthropic" | "openai-compatible" | "local";
  /** 模型 API key；local 可为空 */
  apiKey: string;
  /** 兼容端点；可空 */
  endpoint?: string | null;
  /** 模型引用 */
  modelRef: string;
}

/** onboarding 提交结果（renderer 可见） */
export interface OnboardingSubmitResult {
  /** 是否成功 */
  ok: boolean;
  /** 失败原因；可空 */
  error?: BridgeError;
  /** 提交后的状态 */
  status: OnboardingStatusView;
}

/** 控制面板页面导航目标 */
export type BridgeNavPage =
  | "overview"
  | "tasks"
  | "zhang-boss"
  | "permissions"
  | "diagnostics";

/** 权限页可提交的决策；最终授予仍由 companion permission gate 裁决 */
export type BridgePermissionDecision =
  | "allow_once"
  | "allow_for_job"
  | "deny"
  | "require_more_context";

/**
 * Renderer 可提交的操作意图。
 * 仅表达用户选择；最终副作用仍由 companion backend 裁决。
 */
export type BridgeUiAction =
  | { type: "navigate"; page: BridgeNavPage }
  | { type: "clawCore.restart" }
  | { type: "clawCore.openDiagnostics" }
  /** 重启 Companion 桌面壳；不得与 clawCore.restart（OpenClaw worker）混用 */
  | { type: "companion.restart" }
  | { type: "credential.requestSync" }
  | { type: "credential.requestReauth" }
  | { type: "device.requestPairing" }
  | { type: "device.disconnect"; phoneDeviceId: string }
  | { type: "device.revokePairing"; phoneDeviceId: string; desktopDeviceId: string }
  | { type: "pairing.approve"; pairingId: string }
  | { type: "pairing.reject"; pairingId: string }
  | { type: "pairing.rescan" }
  | { type: "diagnostics.openLogs" }
  | { type: "zhangBoss.openChat" }
  | { type: "affair.viewDetail"; affairId: string }
  | { type: "affair.pause"; affairId: string }
  | { type: "affair.resume"; affairId: string }
  | { type: "affair.cancel"; affairId: string }
  | { type: "affair.requestAcceptance"; affairId: string }
  | {
      type: "permission.decide";
      permissionRequestId: string;
      decision: BridgePermissionDecision;
    }
  | {
      type: "chat.sendMessage";
      text: string;
      affairId?: string | null;
    }
  | {
      type: "chat.attachContext";
      text: string;
      target: "active_call" | "affair";
      contentKind: "path" | "log" | "url" | "note";
      affairId?: string | null;
    };

/**
 * Bridge 错误；可回传给 UI，不得含凭据明文或堆栈里的敏感环境值。
 */
export interface BridgeError {
  /** 稳定错误码 */
  code: string;
  /** 给用户看的说明 */
  message: string;
  /** 是否可重试 */
  retryable: boolean;
}

/** 操作提交成功 */
export interface BridgeActionOk {
  /** 成功标记 */
  ok: true;
  /** 被接受的操作 type */
  acceptedAction: BridgeUiAction["type"];
  /** 给用户看的短提示；permission.decide 等可回传；可空 */
  info?: string | null;
  /** permission.decide 后由 host 回推的待确认列表；可空 */
  pendingPermissionCards?: PendingPermissionCardView[];
}

/** 操作提交失败 */
export interface BridgeActionErr {
  /** 失败标记 */
  ok: false;
  /** 可回传错误 */
  error: BridgeError;
}

/** 操作提交结果 */
export type BridgeActionResult = BridgeActionOk | BridgeActionErr;

/** 通用调用成功 */
export interface BridgeCallOk {
  /** 成功标记 */
  ok: true;
}

/** 通用调用失败 */
export interface BridgeCallErr {
  /** 失败标记 */
  ok: false;
  /** 可回传错误 */
  error: BridgeError;
}

/** 通用 bridge 调用结果（无 action 语义时使用） */
export type BridgeCallResult = BridgeCallOk | BridgeCallErr;

/** Renderer 上报的错误载荷 */
export interface BridgeClientErrorReport {
  /** 错误来源，如 overview / shell */
  source: string;
  /** 短说明；不得粘贴凭据 */
  message: string;
  /** 可选关联 affairId */
  affairId?: string;
}

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
  /** 执行者标签；可空 */
  executor: string | null;
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
  /** 精确文本侧写；可空（旧 snapshot 可无此字段） */
  sideChannel?: SnapshotSideChannelView;
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
