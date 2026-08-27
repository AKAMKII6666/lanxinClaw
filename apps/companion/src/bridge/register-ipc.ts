/**
 * 将 CompanionBridgeHost 挂到 Electron ipcMain。
 *
 * 职责：仅注册白名单通道；把 invoke/事件转给 bridge host。
 * 不拥有：窗口生命周期、pairing、凭据存储；权限裁决由 host 内 gate 执行。
 * 副作用：注册 ipc 监听；在 snapshot 变更时向 webContents 推送。
 */

import { BRIDGE_CHANNELS, type BridgeActionResult } from "./contract.js";
import type {
  BridgeCallResult,
  BridgeClientErrorReport,
  BridgeUiAction,
  ControlPanelSnapshotView,
  OnboardingPhase,
  OnboardingStatusView,
  OnboardingSubmitResult,
  OnboardingSubmitPayload,
  RendererLogEntry,
} from "./contract.js";
import { normalizeOnboardingPayload } from "./onboarding-payload.js";
import { validateRendererLogEntry } from "./guards/renderer-log-guard.js";
import type { SnapshotListener } from "./host.js";
import type { PendingPermissionCardView } from "../permissions/views.js";
import type { DiagnosticReportView } from "../ui/pages/diagnostics/diagnostics-models.js";

/**
 * ipc invoke 处理函数。
 *
 * @param event 来自 Electron 的事件对象（本层不解读）
 * @param args 通道参数
 * @returns 回传给 renderer 的结果
 */
export type IpcInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * 最小 ipcMain 面，便于单测注入。
 */
export interface IpcMainLike {
  /** 注册白名单 invoke 处理 */
  handle: (channel: string, listener: IpcInvokeHandler) => void;
}

/**
 * 最小 webContents 推送面。
 */
export interface WebContentsLike {
  /** 向 renderer 发事件 */
  send: (channel: string, ...args: unknown[]) => void;
}

/**
 * bridge IPC 需要的 host port；可由 CompanionBridgeHost 或 backend runtime 实现。
 */
export interface BridgeIpcHostPort {
  /** 订阅 snapshot */
  subscribeSnapshot(listener: SnapshotListener): () => void;
  /** 读取 snapshot */
  getSnapshot(): ControlPanelSnapshotView;
  /** 提交操作 */
  submitAction(action: BridgeUiAction): BridgeActionResult | Promise<BridgeActionResult>;
  /** 上报错误 */
  reportError(report: BridgeClientErrorReport): BridgeCallResult | Promise<BridgeCallResult>;
  /** 待确认权限 */
  listPendingPermissionCards(): PendingPermissionCardView[];
  /** 诊断报告 */
  getDiagnosticReport?(): DiagnosticReportView | Promise<DiagnosticReportView>;
}

/** 提交/冷启动阶段推送选项（仅进程内回调，不落盘） */
export interface OnboardingProgressOptions {
  /**
   * 阶段推进回调；由 main 转成 onboardingProgress 事件。
   * 可空：测试或无窗口时可省略。
   */
  onPhase?: (phase: OnboardingPhase) => void;
}

/** onboarding IPC 端口 */
export interface OnboardingIpcPort {
  /** 拉取状态 */
  getStatus(): OnboardingStatusView;
  /** 提交配置并探针；options 可空，仅用于阶段推送 */
  submit(config: OnboardingSubmitPayload, options?: OnboardingProgressOptions): Promise<OnboardingSubmitResult>;
  /** 已配置时拉起运行时；options 可空，仅用于阶段推送 */
  bootstrapRuntime(options?: OnboardingProgressOptions): Promise<OnboardingSubmitResult>;
  /** 清除配置 */
  clear(): OnboardingStatusView;
}

/**
 * 注册安全 IPC。
 *
 * @param ipcMain Electron ipcMain 或替身
 * @param host bridge host port
 * @param getWebContents 返回当前主窗口 webContents；可空
 * @param log 可选的 renderer 日志写入端（pino ui 模块）；不传则丢弃
 * @param onboarding 可选 onboarding 端口；不传则通道不可用
 * @returns dispose 以取消 snapshot 订阅
 */
export function registerBridgeIpc(
  ipcMain: IpcMainLike,
  host: BridgeIpcHostPort,
  getWebContents: () => WebContentsLike | null,
  log?: (entry: RendererLogEntry) => void,
  onboarding?: OnboardingIpcPort,
): { dispose: () => void } {
  const unsub = host.subscribeSnapshot((snapshot) => {
    getWebContents()?.send(BRIDGE_CHANNELS.snapshotUpdated, snapshot);
  });

  ipcMain.handle(BRIDGE_CHANNELS.getSnapshot, () => host.getSnapshot());
  ipcMain.handle(BRIDGE_CHANNELS.submitAction, (_event, action) => host.submitAction(action as BridgeUiAction));
  ipcMain.handle(BRIDGE_CHANNELS.reportError, (_event, report) =>
    host.reportError(report as BridgeClientErrorReport),
  );
  ipcMain.handle(BRIDGE_CHANNELS.listPendingPermissions, () => host.listPendingPermissionCards());
  ipcMain.handle(BRIDGE_CHANNELS.getDiagnosticReport, () =>
    host.getDiagnosticReport ? host.getDiagnosticReport() : null,
  );
  ipcMain.handle(BRIDGE_CHANNELS.log, (_event, entry) => {
    const validated = validateRendererLogEntry(entry);
    if (!validated.ok) {
      return validated;
    }
    log?.(validated.value);
    return { ok: true } satisfies BridgeCallResult;
  });
  ipcMain.handle(BRIDGE_CHANNELS.onboardingStatus, () =>
    onboarding ? onboarding.getStatus() : unavailableOnboardingStatus(),
  );
  ipcMain.handle(BRIDGE_CHANNELS.onboardingSubmit, async (_event, config) => {
    if (!onboarding) {
      return {
        ok: false,
        error: { code: "onboarding_unavailable", message: "onboarding 未启用", retryable: false },
        status: unavailableOnboardingStatus(),
      };
    }
    const normalized = normalizeOnboardingPayload(config);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error, status: onboarding.getStatus() };
    }
    const probe = await onboarding.submit(normalized.value, {
      onPhase: (phase) => getWebContents()?.send(BRIDGE_CHANNELS.onboardingProgress, phase),
    });
    return {
      ok: probe.ok,
      ...(probe.error ? { error: probe.error } : {}),
      status: probe.status,
    };
  });
  ipcMain.handle(BRIDGE_CHANNELS.onboardingBootstrapRuntime, async () => {
    if (!onboarding) {
      return {
        ok: false,
        error: { code: "onboarding_unavailable", message: "onboarding 未启用", retryable: false },
        status: unavailableOnboardingStatus(),
      };
    }
    return onboarding.bootstrapRuntime({
      onPhase: (phase) => getWebContents()?.send(BRIDGE_CHANNELS.onboardingProgress, phase),
    });
  });
  ipcMain.handle(BRIDGE_CHANNELS.onboardingClear, () =>
    onboarding ? onboarding.clear() : unavailableOnboardingStatus(),
  );

  return {
    dispose() {
      unsub();
    },
  };
}

/**
 * onboarding 未启用时的占位状态。
 *
 * @returns 状态
 */
function unavailableOnboardingStatus(): OnboardingStatusView {
  return { status: "ready", lastError: null };
}
