/**
 * Companion 桌面壳根组件：侧栏导航 + 各主页面 + 首次 Pairing 弹窗。
 *
 * 职责：挂载主题、导航、主页面与配对确认 Dialog；配置门与冷启动门闩。
 * 不拥有：权限 gate 裁决、pairing 状态机、真实 environment probe。
 * 副作用：仅 React 渲染与 bridge 调用。
 */

import Alert from "@mui/material/Alert";
import CssBaseline from "@mui/material/CssBaseline";
import Snackbar from "@mui/material/Snackbar";
import { ThemeProvider } from "@mui/material/styles";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { BridgeNavPage, ControlPanelSnapshotView } from "../../bridge/contract.js";
import { CompanionBridgeHost } from "../../bridge/host.js";
import type { PendingPairingRequestView } from "../../pairing/views/pending-request-view.js";
import { PermissionGate } from "../../permissions/gate/permission-gate.js";
import {
  createMemoryRendererBridge,
  readPreloadBridge,
  type RendererBridgeApi,
} from "../bridge/renderer-api.js";
import { resolveShellBootTarget } from "../pages/onboarding/boot-gate-state.js";
import { ConfigGate } from "../pages/onboarding/config-gate.js";
import { createLanxinTheme } from "../theme/create-lanxin-theme.js";
import { BootOverlay } from "./boot/boot-overlay.js";
import {
  viewAfterBootstrap,
  viewAfterBootstrapThrow,
  type ShellView,
} from "./boot/shell-view-state.js";
import {
  enterMainAfterConfigured,
  openPairingIfPending,
  pendingPairingFromSnapshot,
  submitPairingAction,
  type PairingUiAction,
} from "./shell-pairing.js";
import { ShellWorkspace } from "./shell-workspace.js";

const theme = createLanxinTheme();

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
      openPairingIfPending(pending, setPairingOpen);
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
        onOpenPairing={() => openPairingIfPending(pendingPairing, setPairingOpen)}
        onPairingAction={(action) =>
          submitPairingAction(bridge, action, setPendingPairing, setPairingOpen)
        }
        onConfigured={() => enterMainAfterConfigured(setSuccessToast, setView)}
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
  onOpenPairing: () => void;
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
        onOpenPairing={props.onOpenPairing}
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
