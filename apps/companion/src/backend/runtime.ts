/**
 * Companion backend runtime。
 *
 * 职责：组合 backend state、snapshot projector、bridge host 与 permission gate。
 * 不拥有：HTTP/WebSocket 监听、OpenClaw runtime 具体实现、renderer UI。
 * 副作用：更新内存 state 并推送 bridge snapshot。
 */

import type { AffairPayload, ProtocolEnvelope } from "@lanxin-claw/protocol";
import { CompanionBridgeHost, type SnapshotListener } from "../bridge/host.js";
import type {
  BridgeActionDelivery,
  BridgeActionResult,
  BridgeUiAction,
  ControlPanelSnapshotView,
} from "../bridge/contract.js";
import type { PendingPermissionCardView } from "../permissions/views.js";
import { PermissionGate } from "../permissions/gate/permission-gate.js";
import { buildDiagnosticReport, type BuildDiagnosticReportInput } from "../diagnostics/probes.js";
import type { DiagnosticReportView } from "../ui/pages/diagnostics/diagnostics-models.js";
import {
  applyProtocolEnvelopeToState,
  createCompanionBackendState,
  reconcileAffairsFromJobs,
} from "../state/store.js";
import { projectControlPanelSnapshot, type SnapshotProjectionExtras } from "../state/projector.js";
import {
  hydrateBackendMirror,
  snapshotBackendMirror,
  type BackendMirrorStore,
} from "../state/mirror/backend-mirror.js";
import type { ApplyProtocolResult, CompanionBackendState } from "../state/types.js";
import { createMemoryAuditStore, type AppendAuditInput } from "../audit/memory-store.js";
import type { AuditRecord, AuditRecordView } from "../audit/types.js";
import {
  createPendingContextQueue,
  type PendingContextQueue,
} from "../chat/channel/pending-context.js";
import {
  createSupervisionNotifyMemory,
  rememberBlockedNotify,
  runSupervisionTick,
} from "../supervision/tick.js";
import { applySupervisionActions } from "../supervision/apply-actions.js";
import type { SupervisionAction, SupervisionSnapshot } from "../supervision/types.js";
import { validateBridgeActionAgainstState } from "./bridge-action-policy.js";
import {
  appendAuditForApplyFailure,
  appendAuditForBridgeAction,
  appendAuditForEnvelope,
  auditRecordsToViews,
  expirePermissionsForTerminalAffair,
} from "./runtime-audit.js";

/**
 * Backend runtime 选项。
 */
export interface CompanionBackendRuntimeOptions {
  /** 初始 state；缺省创建空 state */
  state?: CompanionBackendState;
  /** 权限 gate；缺省空 gate */
  permissionGate?: PermissionGate;
  /** audit store；缺省内存，Electron main 注入文件实现 */
  auditStore?: {
    append: (record: AppendAuditInput) => { ok: true; record: AuditRecord } | { ok: false; code: string; message: string };
    listRecent: (limit?: number) => AuditRecord[];
  };
  /** 诊断实时输入；由 shell/protocol/gateway 层提供 */
  diagnosticsInput?: () => BuildDiagnosticReportInput;
  /** snapshot 投影覆盖（Gateway / 凭据） */
  snapshotExtras?: () => SnapshotProjectionExtras;
  /** in-flight 镜像落盘 */
  mirrorStore?: BackendMirrorStore;
  /** pending 精确文本队列 */
  pendingContext?: PendingContextQueue;
  /** 监督 tick 间隔毫秒；0 关闭。默认关闭，桌面壳显式打开 */
  supervisionIntervalMs?: number;
  /** 把监督动作送到 protocol broadcast（已含 apply）；缺省只写本地 state */
  onProtocolBroadcast?: (envelope: ProtocolEnvelope) => void;
  /** 桌面提醒 */
  onDesktopNotify?: (title: string, body: string) => void;
  /** 桌面设备 id */
  desktopDeviceId?: string;
  /** 撤销配对时回调（identity + protocol） */
  onDeviceRevokePairing?: (input: {
    phoneDeviceId: string;
    desktopDeviceId: string;
  }) => Promise<void>;
  /** bridge action 被接受后的 backend side-effect；不得暴露给 renderer */
  onBridgeAction?: (action: BridgeUiAction, result: BridgeActionResult) => void | Promise<void>;
}

/**
 * Companion backend API。
 */
export interface CompanionBackendRuntime {
  /** 应用入站协议 envelope */
  applyProtocolEnvelope(envelope: ProtocolEnvelope): ApplyProtocolResult;
  /** 应用 UI 操作 */
  applyBridgeAction(action: BridgeUiAction): Promise<BridgeActionResult>;
  /** 订阅 snapshot */
  subscribeSnapshot(listener: SnapshotListener): () => void;
  /** 读取 snapshot */
  getSnapshot(): ControlPanelSnapshotView;
  /** 读取待确认权限卡片 */
  listPendingPermissionCards(): PendingPermissionCardView[];
  /** 标记电话会话失联（心跳超时）；affair/job 保留，业务消息重新要求 session */
  markConnectionLost(): void;
  /** 读取内部 state（测试/诊断用） */
  getState(): CompanionBackendState;
  /** 读取 bridge host */
  getBridgeHost(): CompanionBridgeHost;
  /** 读取权限 gate（仅 backend/server 层使用） */
  getPermissionGate(): PermissionGate;
  /** 读取真实诊断报告 */
  getDiagnosticReport(): DiagnosticReportView;
  /** pending 队列（出站 flush 用） */
  getPendingContext(): PendingContextQueue;
  /** 记录 bridge action 投递后继回执 */
  recordBridgeActionDelivery(delivery: BridgeActionDelivery): void;
  /** 停止监督 loop */
  stopSupervision(): void;
  /** 记录入站 messageId（job.create 等 ack 前去重） */
  recordInboundMessageId(messageId: string): void;
  /**
   * 追加脱敏审计。
   *
   * @param input 审计字段
   */
  appendAudit(input: AppendAuditInput): void;
}

/**
 * 创建 companion backend runtime。
 *
 * @param options 选项
 * @returns runtime
 */
export function createCompanionBackendRuntime(
  options: CompanionBackendRuntimeOptions = {},
): CompanionBackendRuntime {
  const state = options.state ?? createCompanionBackendState();
  const gate = options.permissionGate ?? new PermissionGate();
  const auditStore = options.auditStore ?? createMemoryAuditStore();
  const pendingContext = options.pendingContext ?? createPendingContextQueue();
  if (options.mirrorStore) {
    const loaded = options.mirrorStore.load();
    hydrateBackendMirror(state, loaded);
    reconcileAffairsFromJobs(state);
    pendingContext.restore(loaded.pendingContext ?? []);
  }
  const notifyMemory = createSupervisionNotifyMemory();
  const host = new CompanionBridgeHost(projectNow(), gate);

  function projectNow() {
    return projectControlPanelSnapshot(state, {
      ...options.snapshotExtras?.(),
      pendingContextCount: pendingContext.list().length,
    });
  }

  function persistMirror(): void {
    options.mirrorStore?.save(snapshotBackendMirror(state, pendingContext.list()));
  }

  function rememberBridgeActionDelivery(delivery: BridgeActionDelivery): void {
    state.bridgeActionDeliveries.unshift(delivery);
    state.bridgeActionDeliveries.splice(50);
  }

  function publishSnapshot(): void {
    state.auditRecords = auditRecordsToViews(auditStore.listRecent(50));
    host.setSnapshot(projectNow());
    persistMirror();
  }

  function rememberNotify(actions: readonly SupervisionAction[]): void {
    for (const action of actions) {
      if (action.kind === "notify_blocked") {
        rememberBlockedNotify(notifyMemory, action.affairId, action.fingerprint);
      }
    }
  }

  function superviseAffair(affair: AffairPayload): void {
    const job = affair.currentJobId ? state.jobs.get(affair.currentJobId) : undefined;
    const snapshot: SupervisionSnapshot = {
      affairId: affair.affairId,
      affairTitle: affair.title,
      affairStatus: affair.status as SupervisionSnapshot["affairStatus"],
      jobId: job?.jobId ?? affair.currentJobId ?? null,
      jobStatus: (job?.status as SupervisionSnapshot["jobStatus"]) ?? null,
      jobPurpose: job?.purpose ?? "execution",
      progressSummary: job?.progressSummary ?? "",
      attemptedSteps: [],
      blockedReason: affair.blockedReason ?? job?.blockedReason ?? null,
      resumeCondition: affair.resumeCondition ?? job?.resumeCondition ?? null,
      observedAt: new Date().toISOString(),
    };
    const actions = runSupervisionTick(snapshot, notifyMemory);
    const party = state.connection.phoneDeviceId
      ? {
          desktopDeviceId: options.desktopDeviceId ?? "lanxin-desktop",
          phoneDeviceId: state.connection.phoneDeviceId,
        }
      : null;
    applySupervisionActions(actions, {
      getAffair: (affairId) => state.affairs.get(affairId),
      broadcast: (envelope) => {
        if (options.onProtocolBroadcast) {
          options.onProtocolBroadcast(envelope);
          return;
        }
        applyProtocolEnvelopeToState(state, envelope);
      },
      applyOnly: (envelope) => {
        applyProtocolEnvelopeToState(state, envelope);
      },
      party,
      ...(options.onDesktopNotify ? { onDesktopNotify: options.onDesktopNotify } : {}),
    });
    rememberNotify(actions);
  }

  function runSupervisionPass(): void {
    for (const affair of state.affairs.values()) {
      superviseAffair(affair);
    }
    publishSnapshot();
  }

  const supervisionMs = options.supervisionIntervalMs ?? 0;
  const supervisionTimer =
    supervisionMs > 0
      ? setInterval(() => {
          runSupervisionPass();
        }, supervisionMs)
      : null;
  supervisionTimer?.unref?.();

  return {
    applyProtocolEnvelope(envelope) {
      const result = applyProtocolEnvelopeToState(state, envelope);
      if (!result.ok) {
        appendAuditForApplyFailure(auditStore, envelope, result);
      }
      if (result.ok && !result.duplicate) {
        expirePermissionsForTerminalAffair(gate, auditStore, envelope);
        appendAuditForEnvelope(auditStore, envelope);
        if (envelope.type === "job.blocked" || envelope.type === "job.failed") {
          const payload = envelope.payload as {
            affairId?: string;
            jobId?: string;
            statusReasonCode?: string | null;
          };
          state.lastError = {
            code: payload.statusReasonCode ?? envelope.type,
            message: (envelope.payload as { blockedReason?: string; progressSummary?: string }).blockedReason
              ?? envelope.type,
            occurredAt: new Date().toISOString(),
            affairId: payload.affairId ?? null,
            jobId: payload.jobId ?? null,
          };
        }
      }
      publishSnapshot();
      return result;
    },
    async applyBridgeAction(action) {
      if (action.type === "device.revokePairing") {
        gate.revokeAll();
        state.connection.sessionAuthenticated = false;
        state.connection.sessionId = null;
        state.connection.phoneDeviceId = null;
        state.connection.pairingId = null;
        state.connection.phoneDisplayName = null;
        await options.onDeviceRevokePairing?.({
          phoneDeviceId: action.phoneDeviceId,
          desktopDeviceId: action.desktopDeviceId,
        });
      }
      const statefulError = validateBridgeActionAgainstState(state, action, gate);
      if (statefulError) {
        return statefulError;
      }
      const result = host.submitAction(action);
      if (result.ok) {
        if (action.type === "permission.decide" && (action.decision === "allow_once" || action.decision === "allow_for_job")) {
          const request = gate.getRequest(action.permissionRequestId);
          if (request?.risk === "high") {
            auditStore.append({
              kind: "high_risk_action",
              summary: "用户授予高风险权限",
              permissionRequestId: action.permissionRequestId,
              affairId: request.affairId,
              jobId: request.jobId,
              outcome: action.decision,
            });
          }
        }
        await options.onBridgeAction?.(action, result);
        if (result.delivery) {
          rememberBridgeActionDelivery(result.delivery);
        }
        appendAuditForBridgeAction(auditStore, action, result);
      }
      publishSnapshot();
      return result;
    },
    subscribeSnapshot(listener) {
      return host.subscribeSnapshot(listener);
    },
    getSnapshot() {
      return host.getSnapshot();
    },
    listPendingPermissionCards() {
      return host.listPendingPermissionCards();
    },
    markConnectionLost() {
      state.connection.sessionAuthenticated = false;
      state.connection.lastSeenAt = new Date().toISOString();
      state.lastError = {
        code: "connection_lost",
        message: "电话心跳超时，会话已标记断开；重连需重新 session.open",
        occurredAt: new Date().toISOString(),
      };
      auditStore.append({
        kind: "pairing",
        summary: "电话会话心跳超时，已标记失联",
        outcome: "connection_lost",
      });
      publishSnapshot();
    },
    getState() {
      return state;
    },
    getBridgeHost() {
      return host;
    },
    getPermissionGate() {
      return gate;
    },
    getDiagnosticReport() {
      return buildDiagnosticReport({
        ...options.diagnosticsInput?.(),
        lastError: state.lastError
          ? {
              occurredAt: state.lastError.occurredAt,
              code: state.lastError.code,
              severity: "warn",
              message: state.lastError.message,
              affairId: state.lastError.affairId ?? null,
              jobId: state.lastError.jobId ?? null,
              retryable: false,
            }
          : null,
      });
    },
    getPendingContext() {
      return pendingContext;
    },
    recordBridgeActionDelivery(delivery) {
      rememberBridgeActionDelivery(delivery);
      publishSnapshot();
    },
    stopSupervision() {
      if (supervisionTimer) {
        clearInterval(supervisionTimer);
      }
    },
    recordInboundMessageId(messageId) {
      const now = new Date().toISOString();
      state.seenMessages.set(messageId, { messageId, seenAt: now });
      state.updatedAt = now;
    },
    appendAudit(input) {
      auditStore.append(input);
      publishSnapshot();
    },
  };
}
