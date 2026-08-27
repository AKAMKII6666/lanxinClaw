/**
 * Companion 桌面壳根组件：侧栏导航 + 各主页面 + 首次 Pairing 弹窗。
 *
 * 职责：挂载主题、导航、主页面与配对确认 Dialog；配置门与冷启动门闩。
 * 不拥有：权限 gate 裁决、pairing 状态机、真实 environment probe。
 * 副作用：仅 React 渲染与 bridge 调用。
 */

import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import Snackbar from "@mui/material/Snackbar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import { resolveShellBootTarget } from "../pages/onboarding/boot-gate-state.js";
import { ConfigGate } from "../pages/onboarding/config-gate.js";
import { createLanxinTheme } from "../theme/create-lanxin-theme.js";
import { BootOverlay } from "./boot/boot-overlay.js";
import { ShellMainPages } from "./shell-main-pages.js";
import { ShellSideNav } from "./shell-side-nav.js";
import {
  viewAfterBootstrap,
  viewAfterBootstrapThrow,
  type ShellView,
} from "./boot/shell-view-state.js";

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
  const bridge = useMemo(() => resolveBridge(props.bridge), [props.bridge]);
  const [page, setPage] = useState<BridgeNavPage>("overview");
  const [pendingPairing, setPendingPairing] = useState<PendingPairingRequestView | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [view, setView] = useState<ShellView>({ kind: "loading" });
  const [successToast, setSuccessToast] = useState(false);
  const bootstrapLock = useRef(false);

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

  const runBootstrap = useCallback(async (): Promise<void> => {
    if (bootstrapLock.current) {
      return;
    }
    bootstrapLock.current = true;
    setView({ kind: "bootstrap", phase: "starting_runtime", error: null });
    try {
      setView(viewAfterBootstrap(await bridge.onboarding.bootstrapRuntime()));
    } catch {
      setView(viewAfterBootstrapThrow());
    } finally {
      bootstrapLock.current = false;
    }
  }, [bridge]);

  useEffect(() => {
    let cancelled = false;
    const unsub = bridge.onboarding.subscribeProgress((phase) => {
      setView((current) =>
        current.kind === "bootstrap" ? { ...current, phase, error: current.error } : current,
      );
    });
    void bridge.onboarding.getStatus().then((status) => {
      if (cancelled) {
        return;
      }
      const target = resolveShellBootTarget(status.status);
      if (target === "config") {
        setView({ kind: "config" });
        return;
      }
      if (target === "bootstrap") {
        void runBootstrap();
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [bridge, runBootstrap]);

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
      <ShellAppBody
        bridge={bridge}
        view={view}
        page={page}
        pendingPairing={pendingPairing}
        pairingOpen={pairingOpen && pendingPairing !== null}
        successToast={successToast}
        onNavigate={setPage}
        onPairingAction={submitPairing}
        onConfigured={() => {
          setSuccessToast(true);
          setView({ kind: "main" });
        }}
        onRetryBootstrap={() => void runBootstrap()}
        onCloseToast={() => setSuccessToast(false)}
      />
    </ThemeProvider>
  );
}

/**
 * @param injected 可选注入
 * @returns bridge
 */
function resolveBridge(injected?: RendererBridgeApi): RendererBridgeApi {
  if (injected) {
    return injected;
  }
  return readPreloadBridge() ?? createMemoryRendererBridge(new CompanionBridgeHost(undefined, new PermissionGate()));
}

/**
 * 按 view 渲染配置门 / 冷启动 / 主壳。
 *
 * @param props 视图依赖
 * @returns JSX
 */
function ShellAppBody(props: {
  bridge: RendererBridgeApi;
  view: ShellView;
  page: BridgeNavPage;
  pendingPairing: PendingPairingRequestView | null;
  pairingOpen: boolean;
  successToast: boolean;
  onNavigate: (page: BridgeNavPage) => void;
  onPairingAction: (action: PairingUiAction) => void;
  onConfigured: () => void;
  onRetryBootstrap: () => void;
  onCloseToast: () => void;
}): ReactElement {
  if (props.view.kind === "loading") {
    return (
      <>
        <CssBaseline />
        <BootOverlay phase="starting_runtime" error={null} onRetry={null} />
      </>
    );
  }
  if (props.view.kind === "config") {
    return (
      <>
        <CssBaseline />
        <ConfigGate bridge={props.bridge} onConfigured={props.onConfigured} />
      </>
    );
  }
  if (props.view.kind === "bootstrap") {
    return (
      <>
        <CssBaseline />
        <BootOverlay
          phase={props.view.phase}
          error={props.view.error}
          onRetry={props.view.error ? props.onRetryBootstrap : null}
        />
      </>
    );
  }
  return (
    <>
      <ShellWorkspace
        bridge={props.bridge}
        page={props.page}
        onNavigate={props.onNavigate}
        pendingPairing={props.pendingPairing}
        pairingOpen={props.pairingOpen}
        onPairingAction={props.onPairingAction}
      />
      <Snackbar
        open={props.successToast}
        autoHideDuration={4000}
        onClose={props.onCloseToast}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" onClose={props.onCloseToast}>
          配置成功，运行时已就绪
        </Alert>
      </Snackbar>
    </>
  );
}

/**
 * 主工作区：AppBar + 侧栏 + 主页面 + 配对弹窗。
 *
 * @param props 工作区依赖
 * @returns JSX
 */
function ShellWorkspace(props: {
  bridge: RendererBridgeApi;
  page: BridgeNavPage;
  onNavigate: (page: BridgeNavPage) => void;
  pendingPairing: PendingPairingRequestView | null;
  pairingOpen: boolean;
  onPairingAction: (action: PairingUiAction) => void;
}): ReactElement {
  const { bridge, page, onNavigate, pendingPairing, pairingOpen, onPairingAction } = props;
  return (
    <>
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
            onNavigate(next);
            void bridge.submitAction({ type: "navigate", page: next });
          }}
        />
        <ShellMainPages page={page} bridge={bridge} />
      </Box>
      <FirstPairingDialog
        request={pendingPairing}
        open={pairingOpen}
        onApprove={(pairingId) => onPairingAction({ type: "pairing.approve", pairingId })}
        onReject={(pairingId) => onPairingAction({ type: "pairing.reject", pairingId })}
        onRescan={() => onPairingAction({ type: "pairing.rescan" })}
      />
    </>
  );
}

/**
 * 从真实 snapshot 投影待确认 pairing。
 *
 * @param snapshot 控制面板快照
 * @returns pending 或 null
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
