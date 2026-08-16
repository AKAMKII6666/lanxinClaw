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
import type { ControlPanelSnapshotView } from "../../../bridge/contract.js";
import { projectTaskWorkspaceFromSnapshot } from "./tasks-projection.js";
import { TasksDetailPanel } from "./detail/tasks-detail.js";
import { TasksListPanel } from "./tasks-list.js";
import type { TaskWorkspaceView } from "./tasks-models.js";

/**
 * 任务页：左右分栏工作台。
 *
 * @param props 含 bridge 的属性
 * @returns 任务页 JSX
 */
export function TasksPage(props: { bridge: RendererBridgeApi }): ReactElement {
  const emptyWorkspace = useMemo<TaskWorkspaceView>(
    () => ({ affairs: [], selectedAffairId: null, selectedDetail: null }),
    [],
  );
  const [snapshot, setSnapshot] = useState<ControlPanelSnapshotView | null>(null);
  const [selectedAffairId, setSelectedAffairId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void props.bridge.getSnapshot().then((next) => {
      if (!cancelled) {
        setSnapshot(next);
      }
    });
    const unsubscribe = props.bridge.subscribeSnapshot((next) => {
      setSnapshot(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [props.bridge]);

  const workspace = snapshot
    ? projectTaskWorkspaceFromSnapshot(snapshot, selectedAffairId)
    : emptyWorkspace;
  const detail = workspace.selectedDetail;

  /**
   * 提交任务相关操作；失败时展示错误。
   *
   * @param action 已构造的 bridge 操作
   */
  function submitAffairAction(
    action:
      | { type: "affair.viewDetail"; affairId: string }
      | { type: "affair.pause"; affairId: string }
      | { type: "affair.resume"; affairId: string }
      | { type: "affair.cancel"; affairId: string }
      | { type: "affair.requestAcceptance"; affairId: string },
  ): void {
    void props.bridge.submitAction(action).then((result) => {
      if (!result.ok) {
        setErrorText(result.error.message);
        void props.bridge.reportError({ source: "tasks", message: result.error.message });
      }
    });
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        任务
      </Typography>
      {errorText ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorText(null)}>
          {errorText}
        </Alert>
      ) : null}
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "minmax(240px, 1fr) minmax(0, 2fr)" },
        }}
      >
        <Box>
          <TasksListPanel
            affairs={workspace.affairs}
            selectedAffairId={workspace.selectedAffairId}
            onSelect={(affairId) => {
              setSelectedAffairId(affairId);
              submitAffairAction({ type: "affair.viewDetail", affairId });
            }}
          />
        </Box>
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
          <TasksDetailPanel
            detail={detail}
            onPause={(affairId) => submitAffairAction({ type: "affair.pause", affairId })}
            onResume={(affairId) => submitAffairAction({ type: "affair.resume", affairId })}
            onCancel={(affairId) => submitAffairAction({ type: "affair.cancel", affairId })}
            onRequestAcceptance={(affairId) =>
              submitAffairAction({ type: "affair.requestAcceptance", affairId })
            }
          />
        </Box>
      </Box>
    </Box>
  );
}
