/**
 * 壳侧配对 Dialog 辅助。
 *
 * 职责：pending 投影、打开 Dialog、提交 approve/reject/rescan。
 * 不拥有：pairing 状态机真源、权限 gate。
 * 副作用：submitPairingAction 会调用 bridge。
 */

import type { BridgeUiAction, ControlPanelSnapshotView } from "../../bridge/contract.js";
import type { PendingPairingRequestView } from "../../pairing/views/pending-request-view.js";
import type { RendererBridgeApi } from "../bridge/renderer-api.js";
import type { ShellView } from "./boot/shell-view-state.js";

/** 配对 Dialog 可提交的 UI 动作 */
export type PairingUiAction =
  | { type: "pairing.approve"; pairingId: string }
  | { type: "pairing.reject"; pairingId: string }
  | { type: "pairing.rescan" };

/**
 * @param action 已接受的配对操作
 * @param setPending 设置 pending 请求
 * @param setOpen 设置弹窗开关
 */
export function applyPairingResult(
  action: PairingUiAction,
  setPending: (value: PendingPairingRequestView | null) => void,
  setOpen: (value: boolean) => void,
): void {
  if (action.type === "pairing.rescan") {
    setOpen(false);
    return;
  }
  setOpen(false);
  setPending(null);
}

/**
 * @param pending 当前待确认配对
 * @param setOpen 打开配对 Dialog
 */
export function openPairingIfPending(
  pending: PendingPairingRequestView | null,
  setOpen: (value: boolean) => void,
): void {
  if (pending) {
    setOpen(true);
  }
}

/**
 * @param setToast 成功 Snackbar
 * @param setView 壳视图
 */
export function enterMainAfterConfigured(
  setToast: (value: boolean) => void,
  setView: (value: ShellView) => void,
): void {
  setToast(true);
  setView({ kind: "main" });
}

/**
 * @param bridge 渲染进程 bridge
 * @param action 配对 UI 动作
 * @param setPending 设置 pending 配对
 * @param setOpen 设置配对弹窗开关
 */
export function submitPairingAction(
  bridge: RendererBridgeApi,
  action: PairingUiAction,
  setPending: (value: PendingPairingRequestView | null) => void,
  setOpen: (value: boolean) => void,
): void {
  void bridge.submitAction(action as BridgeUiAction).then((result) => {
    if (!result.ok) {
      void bridge.reportError({ source: "pairing-dialog", message: result.error.message });
      return;
    }
    applyPairingResult(action, setPending, setOpen);
  });
}

/**
 * 从真实 snapshot 投影待确认 pairing。
 *
 * @param snapshot 控制面板快照
 * @returns pending 或 null
 */
export function pendingPairingFromSnapshot(
  snapshot: ControlPanelSnapshotView,
): PendingPairingRequestView | null {
  if (!snapshot.device.pairingId || !snapshot.device.phoneDeviceId || snapshot.device.sessionId) {
    return null;
  }
  return {
    pairingId: snapshot.device.pairingId,
    phoneDeviceId: snapshot.device.phoneDeviceId,
    phoneDisplayName: snapshot.device.phoneDisplayName ?? "澜星电话",
    fingerprintHint: snapshot.device.fingerprintHint ?? "待确认",
    discoveryMethodLabel: "LAN / WebSocket",
    statusLabel: "pairing 中",
    summary: "发现一台澜星电话请求与本机 Claw Companion 配对。确认后双方建立可信会话。",
    dualConfirmHint: "请确认电话端 challenge 已匹配；桌面批准会触发 companion backend 完成配对。",
  };
}
