/**
 * 壳主内容区：按导航页切换已实现页面。
 *
 * 职责：总览 / 任务 / 张老板 / 权限 / 诊断。
 * 不拥有：侧栏、pairing Dialog。
 * 副作用：仅渲染子页。
 */

import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import type { ReactElement } from "react";
import type { BridgeNavPage } from "../../bridge/contract.js";
import type { RendererBridgeApi } from "../bridge/renderer-api.js";
import { DiagnosticsPage } from "../pages/diagnostics/diagnostics-page.js";
import { OverviewPage } from "../pages/overview/overview-page.js";
import { PermissionsPage } from "../pages/permissions/permissions-page.js";
import { TasksPage } from "../pages/tasks/tasks-page.js";
import { ZhangBossPage } from "../pages/zhang-boss/zhang-boss-page.js";

/**
 * @param props 当前页、bridge 与总览快捷操作回调
 * @returns 主内容 JSX
 */
export function ShellMainPages(props: {
  page: BridgeNavPage;
  bridge: RendererBridgeApi;
  onNavigate: (page: BridgeNavPage) => void;
  onOpenPairing: () => void;
}): ReactElement {
  return (
    <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
      <Toolbar />
      {props.page === "overview" ? (
        <OverviewPage
          bridge={props.bridge}
          onNavigate={props.onNavigate}
          onOpenPairing={props.onOpenPairing}
        />
      ) : null}
      {props.page === "tasks" ? <TasksPage bridge={props.bridge} /> : null}
      {props.page === "zhang-boss" ? <ZhangBossPage bridge={props.bridge} /> : null}
      {props.page === "permissions" ? <PermissionsPage bridge={props.bridge} /> : null}
      {props.page === "diagnostics" ? <DiagnosticsPage bridge={props.bridge} /> : null}
    </Box>
  );
}
