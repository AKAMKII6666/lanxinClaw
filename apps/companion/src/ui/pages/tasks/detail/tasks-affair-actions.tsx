/**
 * 任务详情操作按钮条。
 *
 * 职责：按事务状态展示暂停/恢复/取消/请求验收入口。
 * 不拥有：状态机、验收关闭。
 * 副作用：仅回调。
 */

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { ReactElement } from "react";

/**
 * @param props 状态与回调
 * @returns 按钮条 JSX
 */
export function TasksAffairActions(props: {
  affairId: string;
  status: string;
  onPause: (affairId: string) => void;
  onResume: (affairId: string) => void;
  onCancel: (affairId: string) => void;
  onAccept: (affairId: string) => void;
  onRequestRevision: (affairId: string) => void;
  onRequestAcceptance: (affairId: string) => void;
}): ReactElement {
  const isBlocked = props.status === "blocked";
  const isWaitingAcceptance = props.status === "waiting_acceptance";
  const isRunning = props.status === "running" || props.status === "delegated";
  const canCancel = props.status !== "closed" && props.status !== "canceled";

  return (
    <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
      {isRunning ? (
        <Button size="small" variant="outlined" onClick={() => props.onPause(props.affairId)}>
          暂停
        </Button>
      ) : null}
      {isBlocked || props.status === "paused" ? (
        <Button size="small" variant="outlined" onClick={() => props.onResume(props.affairId)}>
          继续处理
        </Button>
      ) : null}
      {isWaitingAcceptance ? (
        <Button size="small" variant="contained" onClick={() => props.onAccept(props.affairId)}>
          接受结果
        </Button>
      ) : null}
      {isWaitingAcceptance ? (
        <Button size="small" variant="outlined" onClick={() => props.onRequestRevision(props.affairId)}>
          继续处理
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          size="small"
          color="error"
          variant="outlined"
          onClick={() => props.onCancel(props.affairId)}
        >
          取消事务
        </Button>
      ) : null}
      {isWaitingAcceptance ? (
        <Button
          size="small"
          variant="outlined"
          onClick={() => props.onRequestAcceptance(props.affairId)}
        >
          让张老板回报
        </Button>
      ) : null}
    </Stack>
  );
}
