/**
 * JobDelegator 类型与常量。
 *
 * 职责：描述委派器依赖、活跃轮询项与轮询停止策略。
 * 不拥有：委派流程、协议发送、adapter 调用。
 * 纯函数：仅类型与常量。
 */

import type {
  AffairPayload,
  JobStatus,
  JobPayload,
  ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import type { AdapterJobRecord, OpenClawAdapter } from "@lanxin-claw/openclaw-adapter";
import type { Logger } from "pino";
import type { PermissionGate } from "../../permissions/gate/permission-gate.js";
import type { ApplyProtocolResult } from "../../state/types.js";
import type { DelegatorJobProjection } from "./projection/delegator-outbound.js";

/** 默认轮询间隔毫秒 */
export const DEFAULT_JOB_POLL_INTERVAL_MS = 2_000;

/** 结束普通执行轮询；blocked 交给事务监督/用户恢复路径处理。 */
export const POLL_STOP_JOB_STATUSES: readonly JobStatus[] = ["blocked", "completed", "failed", "canceled"];

/** in-flight 占位（createJob 完成前） */
export const IN_FLIGHT_PLACEHOLDER = Symbol("in_flight");

/** 委派器依赖 */
export interface JobDelegatorDeps {
  /** 与 UI/WS 共用的事务串行队列 */
  runAffairOperation?: <T>(affairId: string, operation: () => Promise<T>) => Promise<T>;
  /** 已持久化的关闭围栏 */
  isAffairClosing?: (affairId: string) => boolean;
  /** backend 当前完整 job；仅用于执行器尚未登记的取消 */
  getJob?: (jobId: string) => JobPayload | undefined;
  /** 已注入 runtime 的 adapter */
  adapter: OpenClawAdapter;
  /** 桌面授权权威 */
  gate: PermissionGate;
  /** 读协议侧 job 当前状态（backend state） */
  getJobStatus: (jobId: string) => string | undefined;
  /** 读 job 的 workspaceHint，用于授权根校验 */
  getWorkspaceHint?: (jobId: string) => string | null | undefined;
  /** 读 job 用途；exploration completed 不推动 affair 验收 */
  getJobPurpose?: (jobId: string) => "execution" | "exploration" | undefined;
  /** 桌面授权工作区根；越界拒绝委派 */
  authorizedDesktopRoot?: string | null;
  /** 读 affair 当前状态（backend state；投影广播用） */
  getAffair?: (affairId: string) => AffairPayload | undefined;
  /** 已配对电话设备 id（outbound target）；无配对时跳过 WS send */
  getPhoneDeviceId: () => string | null;
  /** 桌面设备 id（outbound source） */
  desktopDeviceId: string;
  /** apply 到 backend */
  applyProtocolEnvelope: (envelope: ProtocolEnvelope<any>) => ApplyProtocolResult;
  /** 仅 WS 发送（backend 已 apply） */
  sendEnvelope: (envelope: ProtocolEnvelope<any>) => void;
  /** 轮询间隔毫秒；默认 2000 */
  pollIntervalMs?: number;
  /** 日志；可选 */
  logger?: Logger;
}

/** 活跃轮询项 */
export interface ActivePoll {
  /** 已取得但 backend 尚未成功提交的快照；重试前不再请求 runtime */
  pendingPublication: PendingJobPublication | null;
  /** 上次已广播的用户可见状态指纹 */
  lastFingerprint: string;
  /** 最近一次成功读取到的 job 投影 */
  lastJob: DelegatorJobProjection;
  /** 是否已有本 job 的读取在途 */
  inFlight: boolean;
  /** 轮询定时器 */
  timer: NodeJS.Timeout;
}

/** 未完整提交的 runtime 快照或明确失败事实。 */
export type PendingJobPublication =
  | { kind: "adapter"; job: AdapterJobRecord }
  | { kind: "failure"; job: DelegatorJobProjection };
