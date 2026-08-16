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
} from "./contract.js";
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

/**
 * 注册安全 IPC。
 *
 * @param ipcMain Electron ipcMain 或替身
 * @param host bridge host port
 * @param getWebContents 返回当前主窗口 webContents；可空
 * @returns dispose 以取消 snapshot 订阅
 */
export function registerBridgeIpc(
  ipcMain: IpcMainLike,
  host: BridgeIpcHostPort,
  getWebContents: () => WebContentsLike | null,
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

  return {
    dispose() {
      unsub();
    },
  };
}
