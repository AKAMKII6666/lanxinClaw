/**
 * 总览五张状态卡网格。
 *
 * 职责：按 snapshot 渲染状态卡，规划操作并转发壳侧导航 / 反馈 / bridge。
 * 不拥有：snapshot 拉取、权限裁决、配对状态机。
 * 副作用：调用 bridge.submitAction 与父级导航回调。
 */

import Box from "@mui/material/Box";
import type { ReactElement } from "react";
import type { BridgeNavPage, ControlPanelSnapshotView } from "../../../bridge/contract.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import {
  planCredentialSync,
  planOpenChat,
  planOpenDiagnostics,
  planRequestPairing,
  planViewTasks,
  snapshotHasPendingPairing,
  type OverviewActionPlan,
} from "./overview-actions.js";
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
 * @param props 含 snapshot、bridge 与壳侧效果回调
 * @returns 状态卡网格
 */
export function OverviewStatusGrid(props: {
  snapshot: ControlPanelSnapshotView;
  bridge: RendererBridgeApi;
  onNavigate: (page: BridgeNavPage) => void;
  onOpenPairing: () => void;
  onFeedback: (message: string) => void;
}): ReactElement {
  const { snapshot, bridge, onNavigate, onOpenPairing, onFeedback } = props;
  const affairStatus = snapshot.currentAffair
    ? labelOf(AFFAIR_STATUS_LABEL, snapshot.currentAffair.status)
    : "无任务";

  function runPlan(plan: OverviewActionPlan): void {
    if (plan.navigateTo) {
      onNavigate(plan.navigateTo);
    }
    if (plan.openPairing) {
      onOpenPairing();
    }
    if (plan.feedback) {
      onFeedback(plan.feedback);
    }
    void bridge.submitAction(plan.bridgeAction);
  }

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
          runPlan(planOpenDiagnostics());
        }}
      />
      <StatusCard
        title="凭据"
        statusLabel={labelOf(CREDENTIAL_STATUS_LABEL, snapshot.credential.status)}
        message={snapshot.credential.message}
        actionLabel="同步"
        onAction={() => {
          runPlan(planCredentialSync(snapshot.credential.status));
        }}
      />
      <StatusCard
        title="澜星电话"
        statusLabel={labelOf(DEVICE_STATUS_LABEL, snapshot.device.status)}
        message={snapshot.device.message}
        actionLabel="重新配对"
        onAction={() => {
          runPlan(planRequestPairing(snapshotHasPendingPairing(snapshot)));
        }}
      />
      <StatusCard
        title="张老板"
        statusLabel={labelOf(ZHANG_BOSS_STATUS_LABEL, snapshot.zhangBoss.status)}
        message={snapshot.zhangBoss.summary}
        actionLabel="打开聊天"
        onAction={() => {
          runPlan(planOpenChat());
        }}
      />
      <StatusCard
        title="当前任务"
        statusLabel={affairStatus}
        message={snapshot.currentAffair?.progressSummary ?? null}
        actionLabel="查看任务"
        onAction={() => {
          runPlan(planViewTasks());
        }}
      />
    </Box>
  );
}
