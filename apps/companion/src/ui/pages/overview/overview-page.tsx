/**
 * 控制面板总览页。
 *
 * 职责：订阅 snapshot，组合状态卡网格与当前任务面板。
 * 不拥有：权限裁决、凭据明文、命令/文件副作用。
 * 副作用：调用 bridge.getSnapshot / subscribe / reportError。
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type ReactElement } from "react";
import type { ControlPanelSnapshotView } from "../../../bridge/contract.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { OverviewStatusGrid } from "./overview-status-grid.js";
import { CurrentAffairPanel } from "./overview-task-panel.js";

/**
 * 总览页：订阅 snapshot 并展示五卡与当前任务。
 *
 * @param props 含 bridge 的属性
 * @returns 总览 JSX
 */
export function OverviewPage(props: { bridge: RendererBridgeApi }): ReactElement {
  const [snapshot, setSnapshot] = useState<ControlPanelSnapshotView | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    props.bridge
      .getSnapshot()
      .then((value) => {
        if (!cancelled) {
          setSnapshot(value);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "无法读取总览状态";
        if (!cancelled) {
          setErrorText(message);
        }
        void props.bridge.reportError({ source: "overview", message });
      });
    const unsub = props.bridge.subscribeSnapshot((next) => {
      setSnapshot(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [props.bridge]);

  if (errorText) {
    return <Alert severity="error">{errorText}</Alert>;
  }
  if (!snapshot) {
    return (
      <Typography color="text.secondary" variant="body2">
        正在加载系统状态…
      </Typography>
    );
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        系统状态
      </Typography>
      <OverviewStatusGrid snapshot={snapshot} bridge={props.bridge} />
      <Box sx={{ mt: 3 }}>
        <CurrentAffairPanel
          affair={snapshot.currentAffair}
          onViewDetail={(affairId) => {
            void props.bridge.submitAction({ type: "affair.viewDetail", affairId });
          }}
        />
      </Box>
    </Box>
  );
}
