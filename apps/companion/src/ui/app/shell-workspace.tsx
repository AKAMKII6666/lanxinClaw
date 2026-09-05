/**
 * 主工作区：AppBar + 侧栏 + 主页面 + 配对弹窗 + 全局授权弹窗。
 *
 * 职责：布局已启动的主壳，并把导航意图同步到 bridge。
 * 不拥有：配置门、冷启动、权限裁决。
 * 副作用：渲染与 bridge.navigate。
 */

import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { BridgeNavPage } from "../../bridge/contract.js";
import type { PendingPairingRequestView } from "../../pairing/views/pending-request-view.js";
import { FirstPairingDialog } from "../dialogs/pairing/first-pairing-dialog.js";
import { PermissionRequestModalHost } from "../dialogs/permissions/permission-request-modal-host.js";
import type { RendererBridgeApi } from "../bridge/renderer-api.js";
import { ShellMainPages } from "./shell-main-pages.js";
import type { PairingUiAction } from "./shell-pairing.js";
import { ShellSideNav } from "./shell-side-nav.js";

const NAV_ITEMS: { page: BridgeNavPage; label: string }[] = [
  { page: "overview", label: "总览" },
  { page: "tasks", label: "任务" },
  { page: "zhang-boss", label: "张老板" },
  { page: "permissions", label: "权限" },
  { page: "diagnostics", label: "诊断" },
];

/**
 * @param props 工作区依赖
 * @returns JSX
 */
export function ShellWorkspace(props: {
  bridge: RendererBridgeApi;
  page: BridgeNavPage;
  onNavigate: (page: BridgeNavPage) => void;
  onOpenPairing: () => void;
  pendingPairing: PendingPairingRequestView | null;
  pairingOpen: boolean;
  onPairingAction: (action: PairingUiAction) => void;
}): ReactElement {
  const { bridge, page, onNavigate, onOpenPairing, pendingPairing, pairingOpen, onPairingAction } =
    props;
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
        <ShellMainPages
          page={page}
          bridge={bridge}
          onNavigate={(next) => {
            onNavigate(next);
            void bridge.submitAction({ type: "navigate", page: next });
          }}
          onOpenPairing={onOpenPairing}
        />
      </Box>
      <FirstPairingDialog
        request={pendingPairing}
        open={pairingOpen}
        onApprove={(pairingId) => onPairingAction({ type: "pairing.approve", pairingId })}
        onReject={(pairingId) => onPairingAction({ type: "pairing.reject", pairingId })}
        onRescan={() => onPairingAction({ type: "pairing.rescan" })}
      />
      <PermissionRequestModalHost bridge={bridge} />
    </>
  );
}
