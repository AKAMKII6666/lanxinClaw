/**
 * Backend state → 控制面板 snapshot 投影。
 *
 * 职责：从 companion backend 唯一真源生成 renderer 可消费的安全摘要。
 * 不拥有：状态迁移、权限裁决、UI 渲染。
 * 纯函数：不产生 I/O。
 */

import { PROTOCOL_VERSION, type AffairPayload } from "@lanxin-claw/protocol";
import type {
  ClawCoreStatusView,
  CompanionStatusView,
  ControlPanelSnapshotView,
  CredentialStatusView,
  CurrentAffairSummaryView,
} from "../bridge/contract.js";
import type { CompanionBackendState } from "./types.js";

/** 事务提醒优先级：用户要先处理的在前 */
const AFFAIR_PRIORITY: Record<string, number> = {
  blocked: 0,
  waiting_acceptance: 1,
  paused: 2,
  running: 3,
  delegated: 4,
  ready: 5,
  clarifying: 6,
};

/**
 * 投影附加运行态（Gateway / 凭据 / 精确文本）。
 */
export interface SnapshotProjectionExtras {
  /** companion 卡覆盖 */
  companion?: Partial<CompanionStatusView>;
  /** OpenClaw 卡 */
  clawCore?: ClawCoreStatusView;
  /** 凭据卡 */
  credential?: CredentialStatusView;
  /** 待投递上下文条数 */
  pendingContextCount?: number;
}

/**
 * 构建控制面板 snapshot。
 *
 * @param state backend state
 * @param extras Gateway 等运行时覆盖
 * @returns snapshot
 */
export function projectControlPanelSnapshot(
  state: CompanionBackendState,
  extras: SnapshotProjectionExtras = {},
): ControlPanelSnapshotView {
  const currentAffair = pickPriorityAffair(state);
  const generatedAt = state.updatedAt;
  const pending = extras.pendingContextCount ?? 0;
  const companionMessage =
    extras.companion?.message ??
    (pending > 0 ? `Companion 已接入；待投递上下文 ${pending} 条` : "Companion backend 已接入真实状态流");
  return {
    schemaVersion: PROTOCOL_VERSION,
    snapshotId: `ui_snap_${Date.parse(generatedAt) || state.startedAtMs}`,
    generatedAt,
    companion: {
      status: extras.companion?.status ?? (state.lastError ? "degraded" : "running"),
      version: extras.companion?.version ?? "0.1.0-dev",
      uptimeMs: extras.companion?.uptimeMs ?? Math.max(0, Date.parse(generatedAt) - state.startedAtMs),
      message: companionMessage,
    },
    clawCore: extras.clawCore ?? {
      status: "stopped",
      version: null,
      adapterReady: false,
      message: "OpenClaw Gateway 未就绪",
    },
    credential: extras.credential ?? {
      status: "missing",
      provider: "openclaw-gateway",
      lastSyncedAt: null,
      expiresAt: null,
      message: "未配置 Gateway 凭据或 secure reference",
    },
    device: {
      status: state.connection.sessionAuthenticated
        ? "connected"
        : state.connection.phoneDeviceId
          ? "pairing"
          : "undiscovered",
      phoneDeviceId: state.connection.phoneDeviceId,
      phoneDisplayName: state.connection.phoneDisplayName,
      pairingId: state.connection.pairingId,
      sessionId: state.connection.sessionId,
      fingerprintHint: null,
      lastSeenAt: state.connection.lastSeenAt,
      message: state.connection.sessionAuthenticated ? "电话会话已认证" : "等待配对或会话认证",
    },
    zhangBoss: {
      status: currentAffair
        ? currentAffair.status === "waiting_acceptance" || currentAffair.status === "blocked"
          ? "waiting_user"
          : "supervising"
        : state.connection.sessionAuthenticated
          ? "online"
          : "offline",
      activeAffairId: currentAffair?.affairId ?? null,
      activeCallId: null,
      summary: currentAffair ? `正在盯「${currentAffair.title}」` : null,
    },
    currentAffair: currentAffair ? toCurrentAffairSummary(state, currentAffair, generatedAt) : null,
    sideChannel: {
      pendingContextCount: extras.pendingContextCount ?? 0,
      messages: state.chatMessages.map((item) => ({
        messageId: item.chatMessageId,
        authorKind: item.authorKind,
        text: item.text,
        sentAt: item.sentAt,
      })),
      attachments: state.contextAttachments.map((item) => ({
        attachId: item.attachId,
        text: item.text,
        contentKind: item.contentKind,
        targetLabel: item.target === "affair" ? "事务" : "当前通话",
        deliveryLabel: "chat.context_attach",
        attachedAt: item.sentAt,
      })),
    },
  };
}

/**
 * 按用户需要处理的优先级选取当前事务。
 *
 * @param state state
 * @returns 优先事务
 */
export function pickPriorityAffair(state: CompanionBackendState): AffairPayload | null {
  return toAffairRef(state);
}

/**
 * @param state state
 * @returns 优先 affair 载荷
 */
function toAffairRef(state: CompanionBackendState): AffairPayload | null {
  const items = [...state.affairs.values()].filter(
    (item) => item.status !== "closed" && item.status !== "canceled",
  );
  items.sort((left, right) => {
    const lp = AFFAIR_PRIORITY[left.status] ?? 99;
    const rp = AFFAIR_PRIORITY[right.status] ?? 99;
    if (lp !== rp) {
      return lp - rp;
    }
    return left.affairId.localeCompare(right.affairId);
  });
  return items[0] ?? null;
}

/**
 * @param state state
 * @param affair affair
 * @param generatedAt 时间
 * @returns 摘要
 */
function toCurrentAffairSummary(
  state: CompanionBackendState,
  affair: AffairPayload,
  generatedAt: string,
): CurrentAffairSummaryView {
  return {
    affairId: affair.affairId,
    title: affair.title,
    status: affair.status,
    currentJobId: affair.currentJobId ?? null,
    executor: affair.currentJobId ? "openclaw" : null,
    progressSummary: progressForAffair(state, affair.affairId),
    blockedReason: affair.blockedReason ?? null,
    resumeCondition: affair.resumeCondition ?? null,
    updatedAt: generatedAt,
  };
}

/**
 * @param state state
 * @param affairId 事务
 * @returns 进度摘要
 */
function progressForAffair(state: CompanionBackendState, affairId: string): string {
  const job = [...state.jobs.values()].reverse().find((item) => item.affairId === affairId);
  return job?.progressSummary || "等待执行进展";
}
