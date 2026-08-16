/**
 * Companion backend runtime。
 *
 * 职责：组合 backend state、snapshot projector、bridge host 与 permission gate。
 * 不拥有：HTTP/WebSocket 监听、OpenClaw runtime 具体实现、renderer UI。
 * 副作用：更新内存 state 并推送 bridge snapshot。
 */

import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import { CompanionBridgeHost, type SnapshotListener } from "../bridge/host.js";
import type {
  BridgeActionResult,
  BridgeUiAction,
  ControlPanelSnapshotView,
} from "../bridge/contract.js";
import type { PendingPermissionCardView } from "../permissions/views.js";
import { PermissionGate } from "../permissions/gate/permission-gate.js";
import { buildDiagnosticReport } from "../diagnostics/probes.js";
import type { DiagnosticReportView } from "../ui/pages/diagnostics/diagnostics-models.js";
import { applyProtocolEnvelopeToState, createCompanionBackendState } from "../state/store.js";
import { projectControlPanelSnapshot } from "../state/projector.js";
import type { ApplyProtocolResult, CompanionBackendState } from "../state/types.js";

/**
 * Backend runtime 选项。
 */
export interface CompanionBackendRuntimeOptions {
  /** 初始 state；缺省创建空 state */
  state?: CompanionBackendState;
  /** 权限 gate；缺省空 gate */
  permissionGate?: PermissionGate;
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
  /** 读取内部 state（测试/诊断用） */
  getState(): CompanionBackendState;
  /** 读取 bridge host */
  getBridgeHost(): CompanionBridgeHost;
  /** 读取权限 gate（仅 backend/server 层使用） */
  getPermissionGate(): PermissionGate;
  /** 读取真实诊断报告 */
  getDiagnosticReport(): DiagnosticReportView;
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
  const host = new CompanionBridgeHost(projectControlPanelSnapshot(state), gate);

  function publishSnapshot(): void {
    host.setSnapshot(projectControlPanelSnapshot(state));
  }

  return {
    applyProtocolEnvelope(envelope) {
      const result = applyProtocolEnvelopeToState(state, envelope);
      publishSnapshot();
      return result;
    },
    async applyBridgeAction(action) {
      const result = host.submitAction(action);
      if (result.ok) {
        await options.onBridgeAction?.(action, result);
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
        gatewayReady: state.jobs.size > 0,
        lanDiscoveryReady: state.connection.phoneDeviceId !== null,
        secureStorageReady: false,
        lastError: state.lastError
          ? {
              occurredAt: state.lastError.occurredAt,
              code: state.lastError.code,
              severity: "warn",
              message: state.lastError.message,
              affairId: null,
              jobId: null,
              retryable: false,
            }
          : null,
      });
    },
  };
}
