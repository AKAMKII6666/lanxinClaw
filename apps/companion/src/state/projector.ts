/**
 * Backend state → 控制面板 snapshot 投影。
 *
 * 职责：从 companion backend 唯一真源生成 renderer 可消费的安全摘要。
 * 不拥有：状态迁移、权限裁决、UI 渲染。
 * 纯函数：不产生 I/O。
 */

import { PROTOCOL_VERSION, type AffairPayload, type JobPayload } from "@lanxin-claw/protocol";
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
  const generatedAt = state.updatedAt;
  const currentAffairRef = toActiveAffairRefs(state)[0] ?? null;
  const currentAffair = currentAffairRef
    ? toCurrentAffairSummary(state, currentAffairRef, generatedAt)
    : null;
  const affairs = toTaskAffairRefs(state).map((affair) => toCurrentAffairSummary(state, affair, generatedAt));
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
    currentAffair,
    affairs,
    recentActionDeliveries: state.bridgeActionDeliveries.slice(0, 20),
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
  return toActiveAffairRefs(state)[0] ?? null;
}

/**
 * @param state state
 * @returns 优先 affair 载荷
 */
function toActiveAffairRefs(state: CompanionBackendState): AffairPayload[] {
  const items = [...state.affairs.values()].filter(
    (item) => item.status !== "closed" && item.status !== "canceled",
  );
  return sortAffairsByPriority(state, items, AFFAIR_PRIORITY);
}

function toTaskAffairRefs(state: CompanionBackendState): AffairPayload[] {
  const open = [...state.affairs.values()].filter(
    (item) => item.status !== "closed" && item.status !== "canceled",
  );
  const terminal = [...state.affairs.values()]
    .filter((item) => item.status === "closed" || item.status === "canceled")
    .sort((left, right) => Date.parse(updatedAtForAffair(state, right)) - Date.parse(updatedAtForAffair(state, left)))
    .slice(0, 10);
  return [...sortAffairsByPriority(state, open, AFFAIR_PRIORITY), ...terminal];
}

function sortAffairsByPriority(
  state: CompanionBackendState,
  items: AffairPayload[],
  priority: Record<string, number>,
): AffairPayload[] {
  items.sort((left, right) => {
    const lp = priority[left.status] ?? 99;
    const rp = priority[right.status] ?? 99;
    if (lp !== rp) {
      return lp - rp;
    }
    const lt = Date.parse(updatedAtForAffair(state, left));
    const rt = Date.parse(updatedAtForAffair(state, right));
    if (Number.isFinite(lt) && Number.isFinite(rt) && lt !== rt) {
      return rt - lt;
    }
    return left.affairId.localeCompare(right.affairId);
  });
  return items;
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
  const job = affair.currentJobId ? state.jobs.get(affair.currentJobId) : undefined;
  return {
    affairId: affair.affairId,
    title: affair.title,
    status: affair.status,
    currentJobId: affair.currentJobId ?? null,
    currentJobStatus: job?.status ?? null,
    currentJobGoal: nonEmptyOrNull(job?.goal),
    currentJobProgressSummary: nonEmptyOrNull(job?.progressSummary),
    currentJobBlockedReason: nonEmptyOrNull(job?.blockedReason),
    currentJobResumeCondition: nonEmptyOrNull(job?.resumeCondition),
    currentJobStatusReasonCode: nonEmptyOrNull(job?.statusReasonCode),
    currentJobStatusObservedAt: nonEmptyOrNull(job?.statusObservedAt),
    executor: job ? "openclaw" : null,
    context: [...affair.context],
    acceptanceCriteria: [...affair.acceptanceCriteria],
    progressSummary: progressForAffair(state, affair),
    blockedReason: affair.blockedReason ?? null,
    resumeCondition: affair.resumeCondition ?? null,
    updatedAt: updatedAtForAffair(state, affair) || generatedAt,
  };
}

function nonEmptyOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function updatedAtForAffair(state: CompanionBackendState, affair: AffairPayload): string {
  const job = affair.currentJobId
    ? state.jobs.get(affair.currentJobId)
    : [...state.jobs.values()].reverse().find((item) => item.affairId === affair.affairId);
  return job?.statusObservedAt ?? state.updatedAt;
}

/**
 * @param state state
 * @param affairId 事务
 * @returns 进度摘要
 */
function progressForAffair(state: CompanionBackendState, affair: AffairPayload): string {
  const job = affair.currentJobId
    ? state.jobs.get(affair.currentJobId)
    : [...state.jobs.values()].reverse().find((item) => item.affairId === affair.affairId);
  const conflict = terminalConflictSummary(affair, job);
  if (conflict) {
    return conflict;
  }
  if (affair.status === "canceled") {
    return "事务已取消";
  }
  if (affair.status === "closed") {
    return "事务已关闭";
  }
  return job?.progressSummary || "等待执行进展";
}

function terminalConflictSummary(affair: AffairPayload, job: JobPayload | undefined): string | null {
  const status = job?.status;
  if (!status || (affair.status !== "canceled" && affair.status !== "closed")) {
    return null;
  }
  if (affair.status === "canceled" && status !== "canceled") {
    return status === "completed"
      ? "历史状态冲突：事务曾被取消，但执行结果后来回来了"
      : "历史状态冲突：事务已取消，但执行 job 仍有后续状态";
  }
  if (affair.status === "closed" && status !== "completed") {
    return "历史状态冲突：事务已关闭，但执行 job 不是完成态";
  }
  return null;
}
