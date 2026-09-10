/**
 * Renderer 侧 bridge 客户端。
 *
 * 职责：统一访问 window.lanxinCompanionBridge，或回退到注入的内存 host。
 * 不拥有：Electron main、权限裁决权威、真实副作用执行。
 * 副作用：仅 IPC invoke / 本地回调；无 Node API。
 */

import type {
  BridgeActionResult,
  BridgeCallResult,
  BridgeClientErrorReport,
  BridgeUiAction,
  ControlPanelSnapshotView,
  OnboardingPhase,
  OnboardingStatusView,
  OnboardingSubmitPayload,
  OnboardingSubmitResult,
  RendererLogEntry,
} from "../../bridge/contract.js";
import type { CompanionBridgeHost } from "../../bridge/host.js";
import type { PendingPermissionCardView } from "../../permissions/views.js";
import type { DiagnosticReportView } from "../pages/diagnostics/diagnostics-models.js";

/**
 * Renderer 可见的安全 bridge 面。
 */
export interface RendererBridgeApi {
  /** 拉取 snapshot */
  getSnapshot(): Promise<ControlPanelSnapshotView>;
  /** 订阅更新；返回取消函数 */
  subscribeSnapshot(listener: (snapshot: ControlPanelSnapshotView) => void): () => void;
  /** 提交用户操作 */
  submitAction(action: BridgeUiAction): Promise<BridgeActionResult>;
  /** 上报展示层错误 */
  reportError(report: BridgeClientErrorReport): Promise<BridgeCallResult>;
  /** 拉取待确认权限卡片（只读；授予由 host gate 持有） */
  listPendingPermissionCards(): Promise<PendingPermissionCardView[]>;
  /** 拉取脱敏诊断报告 */
  getDiagnosticReport(): Promise<DiagnosticReportView>;
  /** 上报 renderer 日志（只读；module 固定为 ui） */
  log(entry: RendererLogEntry): Promise<BridgeCallResult>;
  /** onboarding 配置门 */
  onboarding: {
    /** 拉取状态 */
    getStatus(): Promise<OnboardingStatusView>;
    /** 提交配置并执行探针 */
    submit(config: OnboardingSubmitPayload): Promise<OnboardingSubmitResult>;
    /** 已配置冷启动拉起运行时 */
    bootstrapRuntime(): Promise<OnboardingSubmitResult>;
    /** 清除配置 */
    clear(): Promise<OnboardingStatusView>;
    /** 订阅提交/冷启动阶段；返回取消函数 */
    subscribeProgress(listener: (phase: OnboardingPhase) => void): () => void;
  };
}

/**
 * 将内存 host 适配为 renderer API（无 Electron 时用于测试/开发）。
 *
 * @param host companion bridge 主机实例
 * @returns renderer 可用的安全 API
 */
export function createMemoryRendererBridge(host: CompanionBridgeHost): RendererBridgeApi {
  return {
    async getSnapshot() {
      return host.getSnapshot();
    },
    subscribeSnapshot(listener) {
      return host.subscribeSnapshot(listener);
    },
    async submitAction(action) {
      return host.submitAction(action);
    },
    async reportError(report) {
      return host.reportError(report);
    },
    async listPendingPermissionCards() {
      return host.listPendingPermissionCards();
    },
    async getDiagnosticReport() {
      const snapshot = host.getSnapshot();
      return {
        schemaVersion: snapshot.schemaVersion,
        reportId: `diag_renderer_${snapshot.snapshotId}`,
        generatedAt: snapshot.generatedAt,
        overallStatus: snapshot.clawCore.adapterReady ? "ok" : "warn",
        services: [
          {
            probeId: "companion.service",
            label: "Companion service",
            category: "service",
            status: snapshot.companion.status === "running" ? "ok" : "warn",
            detail: snapshot.companion.message ?? snapshot.companion.status,
            hint: null,
          },
          {
            probeId: "openclaw.gateway",
            label: "OpenClaw Gateway",
            category: "service",
            status: snapshot.clawCore.adapterReady ? "ok" : "warn",
            detail: snapshot.clawCore.message ?? snapshot.clawCore.status,
            hint: snapshot.clawCore.adapterReady ? null : "配置并启动 OpenClaw Gateway 后重试",
          },
        ],
        environment: [
          {
            probeId: "device.session",
            label: "Phone session",
            category: "environment",
            status: snapshot.device.sessionId ? "ok" : "warn",
            detail: snapshot.device.message ?? snapshot.device.status,
            hint: snapshot.device.sessionId ? null : "等待澜星电话完成 pairing 与 session.open",
          },
        ],
        lastError: null,
        browserProxy: { enabled: false, url: "http://127.0.0.1:7890" },
        copyText: `overall=${snapshot.clawCore.adapterReady ? "ok" : "warn"}; companion=${snapshot.companion.status}; device=${snapshot.device.status}`,
      };
    },
    async log(entry) {
      const line = `[ui:${entry.level}] ${entry.message}`;
      if (entry.level === "error") {
        console.error(line, entry.meta ?? "");
      } else if (entry.level === "warn") {
        console.warn(line, entry.meta ?? "");
      } else {
        console.info(line, entry.meta ?? "");
      }
      return { ok: true };
    },
    onboarding: {
      async getStatus() {
        return { status: "ready", lastError: null };
      },
      async submit(_config) {
        return { ok: false, error: { code: "onboarding_unavailable", message: "内存模式未启用 onboarding", retryable: false }, status: { status: "ready", lastError: null } };
      },
      async bootstrapRuntime() {
        return { ok: true, status: { status: "ready", lastError: null } };
      },
      async clear() {
        return { status: "ready", lastError: null };
      },
      subscribeProgress(_listener) {
        return () => undefined;
      },
    },
  };
}

/**
 * 读取 preload 注入的 API；不存在则返回 null。
 *
 * @returns preload bridge 或 null
 */
export function readPreloadBridge(): RendererBridgeApi | null {
  const root = globalThis as typeof globalThis & {
    lanxinCompanionBridge?: RendererBridgeApi;
  };
  return root.lanxinCompanionBridge ?? null;
}

/**
 * 解析 renderer bridge：优先 preload，否则使用提供的 fallback。
 *
 * @param fallback 内存回退
 * @returns 可用 API
 */
export function resolveRendererBridge(fallback: RendererBridgeApi): RendererBridgeApi {
  return readPreloadBridge() ?? fallback;
}
