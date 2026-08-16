/**
 * 权限页真实 snapshot 投影。
 *
 * 职责：把 device/current job/pending cards 投影为权限页视图。
 * 不拥有：identity secret、PermissionGate 裁决、审计持久化。
 * 纯函数：无 I/O；不生成 demo 记录。
 */

import type { ControlPanelSnapshotView } from "../bridge/contract.js";
import type { PermissionPanelView, PendingPermissionCardView } from "./views.js";

/**
 * 从 snapshot 和真实 pending cards 组装权限面板。
 *
 * @param snapshot 控制面板 snapshot
 * @param pendingCards 权限 gate 待确认卡片
 * @returns 权限页视图
 */
export function projectPermissionPanelFromSnapshot(
  snapshot: ControlPanelSnapshotView,
  pendingCards: PendingPermissionCardView[],
): PermissionPanelView {
  const pairedDevice =
    snapshot.device.phoneDeviceId && snapshot.device.pairingId
      ? [{
          pairingId: snapshot.device.pairingId,
          phoneDeviceId: snapshot.device.phoneDeviceId,
          phoneDisplayName: snapshot.device.phoneDisplayName ?? "澜星电话",
          desktopDeviceId: "desktop",
          connectionLabel: snapshot.device.status === "connected" ? "已连接" : "未连接",
          fingerprintHint: snapshot.device.fingerprintHint,
          canRevoke: true,
        }]
      : [];
  return {
    pairedDevices: pairedDevice,
    currentJobId: snapshot.currentAffair?.currentJobId ?? pendingCards[0]?.jobId ?? null,
    jobPermissions: pendingCards.map((card) => ({
      permissionId: card.scopeSummary,
      scopeSummary: card.scopeSummary,
      grantStatus: "pending",
    })),
    pendingCards,
    auditRecords: [],
  };
}
