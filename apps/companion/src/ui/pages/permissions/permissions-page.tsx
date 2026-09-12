/**
 * 控制面板权限页。
 *
 * 职责：展示已配对设备、当前 job 权限、待确认卡片与 revoke 入口；
 * 待确认决策只经 bridge 提交，由 companion backend gate 裁决。
 * 不拥有：renderer 直连文件/命令、凭据明文、PermissionGate 授予权威、OpenClaw、affair 关闭。
 * 副作用：经 bridge 提交断开/撤销/决策意图；本地仅缓存 host 回推的待确认视图。
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type ReactElement } from "react";
import type { ControlPanelSnapshotView } from "../../../bridge/contract.js";
import { projectPermissionPanelFromSnapshot } from "../../../permissions/snapshot-panel-state.js";
import type {
  PairedDeviceView,
  PermissionPanelView,
  PendingPermissionCardView,
  PermissionDecisionChoice,
} from "../../../permissions/views.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { JobPermissionsSection } from "./job-grants/job-permissions-section.js";
import { PairedDevicesSection } from "./paired-devices/paired-devices-section.js";
import { PendingPermissionCardsSection } from "./pending-cards/pending-cards-section.js";
import { AuditLogSection } from "./audit/audit-log-section.js";

type PermissionBridgeAction =
  | { type: "device.disconnect"; phoneDeviceId: string }
  | { type: "device.revokePairing"; phoneDeviceId: string; desktopDeviceId: string }
  | {
      type: "permission.decide";
      permissionRequestId: string;
      decision: PermissionDecisionChoice;
    };

/**
 * 权限页。
 *
 * @param props 含 bridge
 * @returns 权限页 JSX
 */
export function PermissionsPage(props: { bridge: RendererBridgeApi }): ReactElement {
  const data = usePermissionPanelData(props.bridge);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [infoText, setInfoText] = useState<string | null>(null);
  const panel = data.panel;

  function submit(action: PermissionBridgeAction): void {
    void props.bridge.submitAction(action).then((result) => {
      if (!result.ok) {
        setErrorText(result.error.message);
        void props.bridge.reportError({ source: "permissions", message: result.error.message });
        return;
      }
      if (action.type === "permission.decide") {
        if (result.pendingPermissionCards) {
          data.setPendingCards(result.pendingPermissionCards);
        } else {
          void props.bridge.listPendingPermissionCards().then(data.setPendingCards);
        }
        if (result.info) {
          setInfoText(result.info);
        }
      }
    });
  }

  function onDecide(permissionRequestId: string, decision: PermissionDecisionChoice): void {
    submit({ type: "permission.decide", permissionRequestId, decision });
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        权限
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        电脑工作（磁盘、命令行、浏览器、截图、Git）安装后默认允许。本页主要用于管理配对设备；仅极少数敏感权限会要求确认。
      </Typography>
      {errorText ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorText(null)}>
          {errorText}
        </Alert>
      ) : null}
      {infoText ? (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setInfoText(null)}>
          {infoText}
        </Alert>
      ) : null}
      <PairedDevicesSection
        devices={panel.pairedDevices}
        onDisconnect={(device: PairedDeviceView) => {
          submit({ type: "device.disconnect", phoneDeviceId: device.phoneDeviceId });
        }}
        onRevoke={(device: PairedDeviceView) => {
          submit({
            type: "device.revokePairing",
            phoneDeviceId: device.phoneDeviceId,
            desktopDeviceId: device.desktopDeviceId,
          });
        }}
      />
      <JobPermissionsSection currentJobId={panel.currentJobId} grants={panel.jobPermissions} />
      <PendingPermissionCardsSection cards={panel.pendingCards} onDecide={onDecide} />
      <AuditLogSection records={panel.auditRecords} />
    </Box>
  );
}

/**
 * 订阅权限页真实数据。
 */
function usePermissionPanelData(bridge: RendererBridgeApi): {
  panel: PermissionPanelView;
  setPendingCards: (cards: PendingPermissionCardView[]) => void;
} {
  const [snapshot, setSnapshot] = useState<ControlPanelSnapshotView | null>(null);
  const [pendingCards, setPendingCards] = useState<PendingPermissionCardView[]>([]);
  useEffect(() => {
    let cancelled = false;
    void bridge.getSnapshot().then((next) => {
      if (!cancelled) {
        setSnapshot(next);
      }
    });
    void bridge.listPendingPermissionCards().then((cards) => {
      if (!cancelled) {
        setPendingCards(cards);
      }
    });
    const unsubscribe = bridge.subscribeSnapshot((next) => {
      setSnapshot(next);
      void bridge.listPendingPermissionCards().then(setPendingCards);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);
  return {
    panel: snapshot ? projectPermissionPanelFromSnapshot(snapshot, pendingCards) : emptyPanel(pendingCards),
    setPendingCards,
  };
}

/**
 * 空权限面板。
 */
function emptyPanel(pendingCards: PendingPermissionCardView[]): PermissionPanelView {
  return {
    pairedDevices: [],
    jobPermissions: [],
    currentJobId: null,
    pendingCards,
    auditRecords: [],
  };
}
