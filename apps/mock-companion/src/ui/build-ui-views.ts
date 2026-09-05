/**
 * 控制面板 UI 契约视图构建。
 *
 * 职责：从内存 store 生成 snapshot / permission queue / diagnostic report。
 * 不拥有：renderer 渲染、凭据读取、真实探针执行。
 * 纯函数：只读 store；输出不得含 API key / token / 私钥。
 */

import { PROTOCOL_VERSION } from "@lanxin-claw/protocol";
import type { MockCompanionConfig } from "../config.js";
import type { MemoryStore } from "../store/memory-store.js";

/**
 * 选取当前优先展示的事务（非终态优先）。
 *
 * @param store 内存 store
 * @returns affair 或 null
 */
function pickCurrentAffair(store: MemoryStore) {
  return listOpenAffairs(store)[0] ?? [...store.affairs.values()].at(-1) ?? null;
}

function listOpenAffairs(store: MemoryStore) {
  return [...store.affairs.values()].filter(
    (item) => item.status !== "closed" && item.status !== "canceled",
  );
}

/**
 * 推导电话连接状态。
 *
 * @param store 内存 store
 * @returns device.status
 */
function resolveDeviceStatus(store: MemoryStore): string {
  if (store.session) {
    return "connected";
  }
  if (store.paired) {
    return "disconnected";
  }
  return "undiscovered";
}

/**
 * 推导张老板状态卡。
 *
 * @param store 内存 store
 * @param affairStatus 当前事务状态；无事务时为 null
 * @returns zhangBoss.status
 */
function resolveZhangBossStatus(store: MemoryStore, affairStatus: string | null): string {
  if (!store.session) {
    return "offline";
  }
  if (affairStatus === "running" || affairStatus === "delegated") {
    return "supervising";
  }
  if (affairStatus === "blocked" || affairStatus === "waiting_acceptance") {
    return "waiting_user";
  }
  return "online";
}

/**
 * 构建 currentAffair 摘要块。
 *
 * @param store 内存 store
 * @param affair 当前事务
 * @param now ISO 时间
 * @returns currentAffair 对象
 */
function buildCurrentAffairBlock(
  store: MemoryStore,
  affair: NonNullable<ReturnType<typeof pickCurrentAffair>>,
  now: string,
) {
  const job = affair.currentJobId ? store.jobs.get(affair.currentJobId) : undefined;
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
    currentJobStatusReasonCode: null,
    currentJobStatusObservedAt: null,
    executor: job?.executor ?? null,
    context: [...affair.context],
    acceptanceCriteria: [...affair.acceptanceCriteria],
    progressSummary: job?.progressSummary ?? "",
    blockedReason: affair.blockedReason ?? null,
    resumeCondition: affair.resumeCondition ?? null,
    updatedAt: now,
  };
}

function nonEmptyOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/**
 * 构建总览 snapshot。
 *
 * @param store 内存 store
 * @param config 配置
 * @returns 符合控制面板契约的 snapshot 对象
 */
export function buildControlPanelSnapshot(store: MemoryStore, config: MockCompanionConfig) {
  const now = new Date().toISOString();
  const affair = pickCurrentAffair(store);
  const affairs = listOpenAffairs(store).map((item) => buildCurrentAffairBlock(store, item, now));
  return {
    schemaVersion: PROTOCOL_VERSION,
    snapshotId: `ui_snap_${Date.now()}`,
    generatedAt: now,
    companion: {
      status: "running" as const,
      version: config.companionVersion,
      uptimeMs: Date.now() - store.startedAtMs,
      message: null,
    },
    clawCore: {
      status: "running" as const,
      version: "mock",
      adapterReady: true,
      message: "mock worker；非真实 OpenClaw",
    },
    credential: {
      status: "synced" as const,
      provider: "openclaw-api",
      lastSyncedAt: now,
      expiresAt: null,
      message: "仅状态；不含明文 key",
    },
    device: {
      status: resolveDeviceStatus(store),
      phoneDeviceId: store.paired?.phoneDeviceId ?? null,
      phoneDisplayName: store.paired?.phoneDisplayName ?? null,
      pairingId: store.paired?.pairingId ?? null,
      sessionId: store.session?.sessionId ?? null,
      fingerprintHint: store.paired ? "MO:CK:…" : null,
      lastSeenAt: store.session?.openedAt ?? store.paired?.pairedAt ?? null,
      message: null,
    },
    zhangBoss: {
      status: resolveZhangBossStatus(store, affair?.status ?? null),
      activeAffairId: affair?.affairId ?? null,
      activeCallId: null,
      summary: affair ? `正在盯「${affair.title}」` : null,
    },
    currentAffair: affair ? buildCurrentAffairBlock(store, affair, now) : null,
    affairs,
  };
}

/**
 * 构建权限待确认队列。
 *
 * @param store 内存 store
 * @returns PermissionQueue 对象
 */
export function buildPermissionQueue(store: MemoryStore) {
  const now = new Date().toISOString();
  const pending = store.permissionItems.filter((item) => item.queueStatus === "pending");
  return {
    schemaVersion: PROTOCOL_VERSION,
    queueId: `ui_queue_${Date.now()}`,
    generatedAt: now,
    pendingCount: pending.length,
    items: pending,
  };
}

/**
 * 构建诊断报告。
 *
 * @param store 内存 store
 * @param config 配置
 * @returns DiagnosticReport 对象
 */
export function buildDiagnosticReport(store: MemoryStore, config: MockCompanionConfig) {
  const now = new Date().toISOString();
  const hasWarn = store.lastError !== null;
  return {
    schemaVersion: PROTOCOL_VERSION,
    reportId: `ui_diag_${Date.now()}`,
    generatedAt: now,
    overallStatus: hasWarn ? ("warn" as const) : ("ok" as const),
    services: [
      {
        probeId: "companion.service",
        label: "Companion service",
        category: "service",
        status: "ok",
        detail: `running; version=${config.companionVersion}`,
        hint: null,
      },
      {
        probeId: "openclaw.core",
        label: "OpenClaw core",
        category: "service",
        status: "ok",
        detail: "adapterReady=true; runtime=mock",
        hint: null,
      },
      {
        probeId: "credential.api",
        label: "API key 配置态",
        category: "service",
        status: "ok",
        detail: "provider=openclaw-api; status=synced",
        hint: null,
      },
    ],
    environment: [
      {
        probeId: "env.node",
        label: "Node",
        category: "environment",
        status: "ok",
        detail: ">=20 available",
        hint: null,
      },
      {
        probeId: "net.lan_discovery",
        label: "LAN discovery",
        category: "environment",
        status: "warn",
        detail: "mock 不宣告 mDNS",
        hint: "v1.2 再接真实 discovery",
      },
    ],
    lastError: store.lastError,
    copyText: `overall=${hasWarn ? "warn" : "ok"}; companion=ok; openclaw=mock; lastError=${store.lastError?.code ?? "none"}`,
  };
}
