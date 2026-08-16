/**
 * 总览五张状态卡网格。
 *
 * 职责：按 snapshot 渲染状态卡并转发 bridge 操作。
 * 不拥有：snapshot 拉取、权限裁决。
 * 副作用：调用 bridge.submitAction。
 */

import Box from "@mui/material/Box";
import type { ReactElement } from "react";
import type { ControlPanelSnapshotView } from "../../../bridge/contract.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import {
  AFFAIR_STATUS_LABEL,
  CLAW_CORE_STATUS_LABEL,
  CREDENTIAL_STATUS_LABEL,
  DEVICE_STATUS_LABEL,
  ZHANG_BOSS_STATUS_LABEL,
  labelOf,
} from "./overview-labels.js";
import { StatusCard } from "./overview-status-card.js";

/**
 * @param props 含 snapshot 与 bridge
 * @returns 状态卡网格
 */
export function OverviewStatusGrid(props: {
  snapshot: ControlPanelSnapshotView;
  bridge: RendererBridgeApi;
}): ReactElement {
  const { snapshot, bridge } = props;
  const affairStatus = snapshot.currentAffair
    ? labelOf(AFFAIR_STATUS_LABEL, snapshot.currentAffair.status)
    : "无任务";

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: {
          xs: "1fr",
          sm: "1fr 1fr",
          md: "repeat(3, 1fr)",
          lg: "repeat(5, 1fr)",
        },
      }}
    >
      <StatusCard
        title="Claw 核心服务"
        statusLabel={labelOf(CLAW_CORE_STATUS_LABEL, snapshot.clawCore.status)}
        message={snapshot.clawCore.message}
        actionLabel="查看诊断"
        onAction={() => {
          void bridge.submitAction({ type: "clawCore.openDiagnostics" });
        }}
      />
      <StatusCard
        title="凭据"
        statusLabel={labelOf(CREDENTIAL_STATUS_LABEL, snapshot.credential.status)}
        message={snapshot.credential.message}
        actionLabel="同步"
        onAction={() => {
          void bridge.submitAction({ type: "credential.requestSync" });
        }}
      />
      <StatusCard
        title="澜星电话"
        statusLabel={labelOf(DEVICE_STATUS_LABEL, snapshot.device.status)}
        message={snapshot.device.message}
        actionLabel="重新配对"
        onAction={() => {
          void bridge.submitAction({ type: "device.requestPairing" });
        }}
      />
      <StatusCard
        title="张老板"
        statusLabel={labelOf(ZHANG_BOSS_STATUS_LABEL, snapshot.zhangBoss.status)}
        message={snapshot.zhangBoss.summary}
        actionLabel="打开聊天"
        onAction={() => {
          void bridge.submitAction({ type: "zhangBoss.openChat" });
        }}
      />
      <StatusCard
        title="当前任务"
        statusLabel={affairStatus}
        message={snapshot.currentAffair?.progressSummary ?? null}
        actionLabel="查看任务"
        onAction={() => {
          void bridge.submitAction({ type: "navigate", page: "tasks" });
        }}
      />
    </Box>
  );
}
