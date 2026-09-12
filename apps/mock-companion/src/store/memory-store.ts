/**
 * 内存态事务 / job / 配对 / 事件簿。
 *
 * 职责：为 mock companion 保存可恢复的 id 化状态与事件日志。
 * 不拥有：真实权限授予、磁盘持久化、OpenClaw run 生命周期。
 * 副作用：仅变更进程内 Map；不写凭据明文。
 */

import type { AffairPayload, JobPayload } from "@lanxin-claw/protocol";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";

/**
 * 已配对设备摘要（无私钥）。
 */
export interface PairedDeviceState {
  /** 配对流程 id */
  pairingId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 电话展示名 */
  phoneDisplayName: string;
  /** 可用于 session.open HMAC 的配对秘密；不得展示或写审计 */
  pairingSecret: string;
  /** 配对完成时间 */
  pairedAt: string;
}

/**
 * 当前 session 摘要。
 */
export interface SessionState {
  /** session id */
  sessionId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 打开时间 */
  openedAt: string;
}

/**
 * 控制面板 lastError 形状（无凭据）。
 */
export interface StoreLastError {
  occurredAt: string;
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
  affairId: string | null;
  jobId: string | null;
  retryable: boolean;
}

/**
 * 待确认权限队列项（mock）。
 */
export interface StorePermissionItem {
  permissionRequestId: string;
  queueStatus: "pending" | "resolved" | "expired";
  requester: string;
  affairId: string | null;
  jobId: string | null;
  requestedPermissions: string[];
  reason: string;
  risk: "low" | "medium" | "high";
  proposedScope: {
    workspaceRoot: string | null;
    commands: string[];
    networkHosts: string[];
  };
  availableDecisions: string[];
  denyConsequence: string;
  requestedAt: string;
  expiresAt: string | null;
}

/**
 * 内存 store。
 */
export interface MemoryStore {
  /** 服务启动时间 */
  readonly startedAtMs: number;
  affairs: Map<string, AffairPayload>;
  jobs: Map<string, JobPayload>;
  paired: PairedDeviceState | null;
  session: SessionState | null;
  pendingChallenge: {
    pairingId: string;
    challenge: string;
    expiresAt: string;
    phoneDeviceId: string;
    phoneDisplayName: string;
  } | null;
  permissionItems: StorePermissionItem[];
  lastError: StoreLastError | null;
  events: ProtocolEnvelope<any>[];
}

/**
 * 创建空内存 store。
 *
 * @param startedAtMs 启动时间戳
 * @returns 新 store
 */
export function createMemoryStore(startedAtMs: number): MemoryStore {
  return {
    startedAtMs,
    affairs: new Map(),
    jobs: new Map(),
    paired: null,
    session: null,
    pendingChallenge: null,
    permissionItems: [],
    lastError: null,
    events: [],
  };
}

/**
 * 追加一条已发出的协议事件（供 HTTP /events 与脚本消费）。
 *
 * @param store 内存 store
 * @param envelope 已发出的 envelope
 */
export function appendEvent(store: MemoryStore, envelope: ProtocolEnvelope<any>): void {
  store.events.push(envelope);
}

/**
 * 按 messageId 查找事件，便于幂等跳过。
 *
 * @param store 内存 store
 * @param messageId 消息 id
 * @returns 是否已存在
 */
export function hasEventMessageId(store: MemoryStore, messageId: string): boolean {
  return store.events.some((item) => item.messageId === messageId);
}
