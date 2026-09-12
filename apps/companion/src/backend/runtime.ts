/**
 * Companion backend runtime。
 *
 * 职责：组合 backend state、snapshot projector、bridge host 与 permission gate。
 * 不拥有：HTTP/WebSocket 监听、OpenClaw runtime 具体实现、renderer UI。
 * 副作用：更新内存 state 并推送 bridge snapshot。
 */
import { superviseBackendAffair } from "./supervision/observe.js";


import type { AffairPayload } from "@lanxin-claw/protocol";
import { AffairActionCoordinator } from "../affairs/actions/coordinator.js";
import { commitJobCreation } from "./jobs/create.js";
import { createMemoryAuditStore } from "../audit/memory-store.js";
import type {
BridgeActionDelivery
} from "../bridge/contract.js";
import { CompanionBridgeHost } from "../bridge/host.js";
import {
createPendingContextQueue
} from "../chat/channel/pending-context.js";
import { buildDiagnosticReport } from "../diagnostics/probes.js";
import { PermissionGate } from "../permissions/gate/permission-gate.js";
import {
hydrateBackendMirror,
snapshotBackendMirror
} from "../state/mirror/backend-mirror.js";
import { projectControlPanelSnapshot } from "../state/projector.js";
import {
applyProtocolEnvelopeToState,
createCompanionBackendState,
reconcileAffairsFromJobs,
} from "../state/store.js";
import {
createSupervisionNotifyMemory
} from "../supervision/tick.js";
import { validateBridgeActionAgainstState } from "./bridge-action-policy.js";
import { applyMessageReceipt } from "./chat/message-receipts.js";
import {
appendAuditForApplyFailure,
appendAuditForBridgeAction,
appendAuditForEnvelope,
auditRecordsToViews,
expirePermissionsForTerminalAffair,
} from "./runtime-audit.js";

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
  const affairActions = new AffairActionCoordinator({ state, gate, persist: persistMirror, publish: publishSnapshot });

  function projectNow() {
    return projectControlPanelSnapshot(state, {
      ...options.snapshotExtras?.(),
      pendingContextCount: pendingContext.list().length,
    });
  }

  function persistMirror(): void {
    options.mirrorStore?.save(snapshotBackendMirror(state, pendingContext.list()));
  }

  pendingContext.setOnChange(persistMirror);

  function rememberBridgeActionDelivery(delivery: BridgeActionDelivery): void {
    state.bridgeActionDeliveries.unshift(delivery);
    state.bridgeActionDeliveries.splice(50);
  }

  function publishSnapshot(): void {
    state.auditRecords = auditRecordsToViews(auditStore.listRecent(50));
    host.setSnapshot(projectNow());
    persistMirror();
  }

  function runSupervisionPass(): void {
    for (const affair of state.affairs.values()) {
      superviseBackendAffair(state, affair, options, notifyMemory);
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
    applyJobCreation(command, events) {
      const result = commitJobCreation(state, command, events, persistMirror);
      if (result.ok) {
        for (const event of events) appendAuditForEnvelope(auditStore, event);
        host.setSnapshot(projectNow());
      }
      return result;
    },
    getAffairActions: () => affairActions,
    applyProtocolEnvelope(envelope) {
      if (envelope.type === "chat.read_receipt") {
        const receipt = applyMessageReceipt(state, pendingContext, envelope, persistMirror);
        if (receipt.ok) publishSnapshot();
        return receipt;
      }
      if (envelope.type === "affair.close") {
        return { ok: false, code: "affair_action_required", message: "关闭命令与结果由事务协调器处理", retryable: false };
      }
      if (envelope.type.startsWith("affair.")) {
        const fact = envelope.payload as { affairId?: string; status?: string };
        if (fact.affairId && ["closed", "canceled"].includes(fact.status ?? "") &&
            state.affairs.get(fact.affairId)?.status !== fact.status) {
          return { ok: false, code: "affair_action_required", message: "终态必须由共同事务协调器提交", retryable: false };
        }
      }
      if (envelope.source.kind === "phone" && envelope.type.startsWith("affair.")) {
        const payload = envelope.payload as unknown as AffairPayload;
        if (["closed", "canceled"].includes(payload.status) || affairActions.isClosing(payload.affairId)) {
          return { ok: false, code: "affair_action_required", message: "事务关闭必须经动作协调器确认", retryable: false };
        }
      }
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
      if ((action.type === "affair.accept" || action.type === "affair.cancel") && !options.onBridgeAction) {
        return { ok: false, error: { code: "affair_action_unavailable", message: "事务协调器尚未接入桌面动作", retryable: true } };
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

import type { CompanionBackendRuntime, CompanionBackendRuntimeOptions } from "./contracts/runtime.js";
export type { CompanionBackendRuntime, CompanionBackendRuntimeOptions } from "./contracts/runtime.js";
