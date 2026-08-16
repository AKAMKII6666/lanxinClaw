/**
 * Companion 桌面壳根组件：侧栏导航 + 各主页面 + 首次 Pairing 弹窗。
 *
 * 职责：挂载主题、导航、主页面与配对确认 Dialog。
 * 不拥有：权限 gate 裁决、pairing 状态机、真实 environment probe。
 * 副作用：仅 React 渲染与 bridge 调用。
 */

import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { BridgeNavPage, BridgeUiAction, ControlPanelSnapshotView } from "../../bridge/contract.js";
import { CompanionBridgeHost } from "../../bridge/host.js";
import type { PendingPairingRequestView } from "../../pairing/views/pending-request-view.js";
import { PermissionGate } from "../../permissions/gate/permission-gate.js";
import {
  createMemoryRendererBridge,
  readPreloadBridge,
  type RendererBridgeApi,
} from "../bridge/renderer-api.js";
import { FirstPairingDialog } from "../dialogs/pairing/first-pairing-dialog.js";
import { createLanxinTheme } from "../theme/create-lanxin-theme.js";
import { ShellMainPages } from "./shell-main-pages.js";
import { ShellSideNav } from "./shell-side-nav.js";

const theme = createLanxinTheme();

const NAV_ITEMS: { page: BridgeNavPage; label: string }[] = [
  { page: "overview", label: "总览" },
  { page: "tasks", label: "任务" },
  { page: "zhang-boss", label: "张老板" },
  { page: "permissions", label: "权限" },
  { page: "diagnostics", label: "诊断" },
];

type PairingUiAction =
  | { type: "pairing.approve"; pairingId: string }
  | { type: "pairing.reject"; pairingId: string }
  | { type: "pairing.rescan" };

/**
 * 处理配对弹窗提交结果，更新本地 pending 状态。
 *
 * @param action 已接受的配对操作
 * @param setPending 设置 pending 请求
 * @param setOpen 设置弹窗开关
 */
function applyPairingResult(
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
 * @param props.bridge 可选注入；缺省解析 preload 或内存 host
 * @returns 壳 JSX
 */
export function ShellApp(props: { bridge?: RendererBridgeApi } = {}): ReactElement {
  const bridge = useMemo(() => {
    if (props.bridge) {
      return props.bridge;
    }
    const preload = readPreloadBridge();
    if (preload) {
      return preload;
    }
    return createMemoryRendererBridge(new CompanionBridgeHost(undefined, new PermissionGate()));
  }, [props.bridge]);
  const [page, setPage] = useState<BridgeNavPage>("overview");
  const [pendingPairing, setPendingPairing] = useState<PendingPairingRequestView | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);

  useEffect(() => {
    const applySnapshot = (snapshot: ControlPanelSnapshotView) => {
      const pending = pendingPairingFromSnapshot(snapshot);
      setPendingPairing(pending);
      if (pending) {
        setPairingOpen(true);
      }
    };
    void bridge.getSnapshot().then(applySnapshot);
    return bridge.subscribeSnapshot(applySnapshot);
  }, [bridge]);

  /**
   * @param action 配对白名单操作
   */
  function submitPairing(action: PairingUiAction): void {
    void bridge.submitAction(action as BridgeUiAction).then((result) => {
      if (!result.ok) {
        void bridge.reportError({ source: "pairing-dialog", message: result.error.message });
        return;
      }
      applyPairingResult(action, setPendingPairing, setPairingOpen);
    });
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
        <AppBar
          position="fixed"
          elevation={0}
          color="transparent"
          sx={{
            zIndex: (t) => t.zIndex.drawer + 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Toolbar>
            <Typography variant="h6" component="h1" color="text.primary">
              澜星 Claw
            </Typography>
          </Toolbar>
        </AppBar>
        <ShellSideNav
          page={page}
          items={NAV_ITEMS}
          onNavigate={(next) => {
            setPage(next);
            void bridge.submitAction({ type: "navigate", page: next });
          }}
        />
        <ShellMainPages page={page} bridge={bridge} />
      </Box>
      <FirstPairingDialog
        request={pendingPairing}
        open={pairingOpen && pendingPairing !== null}
        onApprove={(pairingId) => submitPairing({ type: "pairing.approve", pairingId })}
        onReject={(pairingId) => submitPairing({ type: "pairing.reject", pairingId })}
        onRescan={() => submitPairing({ type: "pairing.rescan" })}
      />
    </ThemeProvider>
  );
}

/**
 * 从真实 snapshot 投影待确认 pairing。
 */
function pendingPairingFromSnapshot(snapshot: ControlPanelSnapshotView): PendingPairingRequestView | null {
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
