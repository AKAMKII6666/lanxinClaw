/**
 * Companion protocol server 选项与句柄类型。
 *
 * 职责：描述 startCompanionProtocolServer 入参与返回面。
 * 不拥有：HTTP/WS 监听实现。
 * 纯函数：仅类型。
 */

import type { WebSocket } from "ws";
import type { Logger } from "pino";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { PairingLifecycleDeps } from "../pairing/lifecycle.js";
import type { DeviceIdentityStore } from "../credentials/identity-store.js";
import type { CompanionBackendRuntime } from "../backend/runtime.js";
import type { ApplyProtocolResult } from "../state/types.js";
import type { OpenClawToolCapabilitySummary } from "../gateway-runtime/openclaw-capability.js";

/** Server 选项 */
export interface CompanionProtocolServerOptions {
  /** 监听端口；0 表示随机端口 */
  port?: number;
  /** 监听 host；默认 127.0.0.1 */
  host?: string;
  /** backend runtime */
  backend: CompanionBackendRuntime;
  /** identity store */
  identityStore: DeviceIdentityStore;
  /** pairing 依赖 */
  pairing: PairingLifecycleDeps;
  /** 心跳间隔毫秒；缺省 5000（与 session.accepted 广播一致） */
  heartbeatIntervalMs?: number;
  /** 连续错过多少次心跳判定超时；缺省 3 */
  missedHeartbeats?: number;
  /** job.cancel 处理器（真正取消 OpenClaw run）；缺省仅状态闭环 */
  onJobCancel?: (input: { jobId: string; affairId: string }) => Promise<void>;
  /** session.accepted 之后回调（flush pending context） */
  onSessionAccepted?: () => void;
  /** 协议落盘日志；只记录 redacted DTO 与状态证据 */
  logger?: Logger;
  /** OpenClaw 工具能力探针（job.create 预检） */
  getOpenClawToolCapabilities?: () => OpenClawToolCapabilitySummary;
}

/** Server 句柄 */
export interface CompanionProtocolServerHandle {
  /** HTTP base URL */
  baseUrl: string;
  /** WebSocket URL */
  wsUrl: string;
  /** 实际监听端口 */
  port: number;
  /** 广播协议 envelope（先 apply backend，再发客户端）；apply 失败时不 send */
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult;
  /** 仅 WS 发送（假定 backend 已 apply） */
  sendEnvelope: (envelope: ProtocolEnvelope) => void;
  /** session.open 成功时替换为单活 authenticated socket */
  replaceAuthenticatedSocket: (socket: WebSocket) => void;
  /** 清除全部已认证 socket（配对撤销/会话关闭） */
  clearAuthenticatedSockets: () => void;
  /** 桌面批准当前 pairing */
  approvePairing: (pairingId: string) => Promise<void>;
  /**
   * 当前待桌面批准的 pairingId。
   * @returns pairingId；无 pending 时为 null
   */
  getPendingPairingId: () => string | null;
  /** 关闭 server */
  close: () => Promise<void>;
}
