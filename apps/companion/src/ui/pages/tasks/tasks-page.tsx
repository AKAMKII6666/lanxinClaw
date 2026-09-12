/**
 * 控制面板任务页。
 *
 * 职责：展示 affair 列表与 job 详情（含 progress / blocked / waiting_acceptance）。
 * 不拥有：事务关闭裁决、OpenClaw 执行、权限授予。
 * 副作用：经 bridge 提交用户操作意图。
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import type { BridgeUiAction, BridgeActionDelivery, ControlPanelSnapshotView } from "../../../bridge/contract.js";
import { projectTaskWorkspaceFromSnapshot } from "./tasks-projection.js";
import { TasksDetailPanel } from "./detail/tasks-detail.js";
import { TasksListPanel } from "./tasks-list.js";
import type { TaskWorkspaceView } from "./tasks-models.js";

type TaskBridgeAction = Extract<BridgeUiAction, { affairId: string }>;

function deliverySeverity(delivery: BridgeActionDelivery): "error" | "warning" | "info" {
  if (delivery.status === "rejected") {
    return "error";
  }
  return delivery.status === "queued_until_session" ? "warning" : "info";
}

function deliveryDismissKey(delivery: BridgeActionDelivery): string {
  return [
    delivery.actionReceiptId,
    delivery.status,
    delivery.deliveredAt ?? "",
    delivery.reasonCode ?? "",
  ].join(":");
}

function TaskActionFeedback(props: {
  errorText: string | null;
  delivery: BridgeActionDelivery | null;
  onClearError: () => void;
  onClearDelivery: () => void;
}): ReactElement | null {
  if (props.errorText) {
    return (
      <Alert severity="error" sx={{ mb: 2 }} onClose={props.onClearError}>
        {props.errorText}
      </Alert>
    );
  }
  if (!props.delivery) {
    return null;
  }
  return (
    <Alert severity={deliverySeverity(props.delivery)} sx={{ mb: 2 }} onClose={props.onClearDelivery}>
      {props.delivery.message}
    </Alert>
  );
}

interface TasksPageModel {
  workspace: TaskWorkspaceView;
  detail: TaskWorkspaceView["selectedDetail"];
  errorText: string | null;
  visibleDelivery: BridgeActionDelivery | null;
  clearError: () => void;
  clearDelivery: () => void;
  selectAffair: (affairId: string) => void;
  submitAffairAction: (action: TaskBridgeAction) => void;
}

function useTasksPageModel(bridge: RendererBridgeApi): TasksPageModel {
  const emptyWorkspace = useMemo<TaskWorkspaceView>(
    () => ({ affairs: [], selectedAffairId: null, selectedDetail: null }),
    [],
  );
  const [snapshot, setSnapshot] = useState<ControlPanelSnapshotView | null>(null);
  const [selectedAffairId, setSelectedAffairId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<BridgeActionDelivery | null>(null);
  const [dismissedDeliveryKey, setDismissedDeliveryKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bridge.getSnapshot().then((next) => {
      if (!cancelled) {
        setSnapshot(next);
      }
    });
    const unsubscribe = bridge.subscribeSnapshot((next) => {
      setSnapshot(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  const workspace = snapshot
    ? projectTaskWorkspaceFromSnapshot(snapshot, selectedAffairId)
    : emptyWorkspace;
  const detail = workspace.selectedDetail;
  const latestSnapshotDelivery = snapshot?.recentActionDeliveries?.[0] ?? null;
  const currentDelivery = delivery ?? latestSnapshotDelivery;
  const visibleDelivery =
    currentDelivery && deliveryDismissKey(currentDelivery) !== dismissedDeliveryKey
      ? currentDelivery
      : null;

  function submitAffairAction(action: TaskBridgeAction): void {
    void bridge.submitAction(action).then((result) => {
      if (!result.ok) {
        setErrorText(result.error.message);
        setDelivery(null);
        void bridge.reportError({ source: "tasks", message: result.error.message });
        return;
      }
      setErrorText(null);
      if (result.delivery) {
        setDelivery(result.delivery);
        setDismissedDeliveryKey(null);
      }
    });
  }

  return {
    workspace,
    detail,
    errorText,
    visibleDelivery,
    clearError: () => setErrorText(null),
    clearDelivery: () => {
      if (visibleDelivery) {
        setDismissedDeliveryKey(deliveryDismissKey(visibleDelivery));
      }
      setDelivery(null);
    },
    selectAffair: (affairId) => {
      setSelectedAffairId(affairId);
      submitAffairAction({ type: "affair.viewDetail", affairId });
    },
    submitAffairAction,
  };
}

/**
 * 任务页：左右分栏工作台。
 *
 * @param props 含 bridge 的属性
 * @returns 任务页 JSX
 */
export function TasksPage(props: { bridge: RendererBridgeApi }): ReactElement {
  const model = useTasksPageModel(props.bridge);

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        任务
      </Typography>
      <TaskActionFeedback
        errorText={model.errorText}
        delivery={model.visibleDelivery}
        onClearError={model.clearError}
        onClearDelivery={model.clearDelivery}
      />
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "minmax(240px, 1fr) minmax(0, 2fr)" },
        }}
      >
        <Box>
          <TasksListPanel
            affairs={model.workspace.affairs}
            selectedAffairId={model.workspace.selectedAffairId}
            onSelect={model.selectAffair}
          />
        </Box>
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
          <TasksDetailPanel
            detail={model.detail}
            onPause={(affairId) => model.submitAffairAction({ type: "affair.pause", affairId })}
            onResume={(affairId) => model.submitAffairAction({ type: "affair.resume", affairId })}
            onCancel={(affairId) => model.submitAffairAction({ type: "affair.cancel", affairId })}
            onAccept={(affairId) => model.submitAffairAction({ type: "affair.accept", affairId,
              expectedCurrentJobId: model.detail?.currentJob?.jobId ?? "",
              acceptanceSummary: `桌面用户确认验收：${model.detail?.currentJob?.progressSummary ?? ""}`,
            })}
            onRequestRevision={(affairId) =>
              model.submitAffairAction({ type: "affair.requestRevision", affairId })
            }
            onRequestAcceptance={(affairId) =>
              model.submitAffairAction({ type: "affair.requestAcceptance", affairId })
            }
          />
        </Box>
      </Box>
    </Box>
  );
}
