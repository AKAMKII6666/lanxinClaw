/**
 * 任务页右侧详情面板。
 *
 * 职责：展示事务目标、job 进展、blocked / waiting_acceptance 与操作入口。
 * 不拥有：affair 关闭裁决、OpenClaw、权限授予。
 * 副作用：仅通过回调提交用户意图。
 */

import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import { TasksAffairActions } from "./tasks-affair-actions.js";
import { TasksAffairTimeline } from "./timeline/tasks-affair-timeline.js";
import { TasksJobProgress } from "./tasks-job-progress.js";
import { AFFAIR_STATUS_LABEL, labelOf } from "../tasks-labels.js";
import type { AffairDetailView } from "../tasks-models.js";

/**
 * @param props 详情与操作回调
 * @returns 详情 JSX
 */
export function TasksDetailPanel(props: {
  detail: AffairDetailView | null;
  onPause: (affairId: string) => void;
  onResume: (affairId: string) => void;
  onCancel: (affairId: string) => void;
  onAccept: (affairId: string) => void;
  onRequestRevision: (affairId: string) => void;
  onRequestAcceptance: (affairId: string) => void;
}): ReactElement {
  if (!props.detail) {
    return (
      <Typography color="text.secondary" variant="body2">
        选择左侧事务以查看详情
      </Typography>
    );
  }

  const detail = props.detail;
  return (
    <Box>
      <Typography variant="h6">{detail.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        状态：{labelOf(AFFAIR_STATUS_LABEL, detail.status)} · 负责人：{detail.ownerLabel}
        {detail.currentJob ? ` · 执行者：${detail.currentJob.executor}` : ""}
      </Typography>

      {detail.acceptanceCriteria.length > 0 ? (
        <>
          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            完成标准
          </Typography>
          <Box component="ul" sx={{ mt: 0.5, pl: 2 }}>
            {detail.acceptanceCriteria.map((item) => (
              <Typography component="li" key={item} variant="body2">
                {item}
              </Typography>
            ))}
          </Box>
        </>
      ) : (
        <Alert severity="info" sx={{ mt: 2 }}>
          这件事还没有明确完成标准；验收前最好让张老板补齐标准。
        </Alert>
      )}

      {detail.context.length > 0 ? (
        <>
          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            上下文
          </Typography>
          <Box component="ul" sx={{ mt: 0.5, pl: 2 }}>
            {detail.context.map((item) => (
              <Typography component="li" key={item} variant="body2">
                {item}
              </Typography>
            ))}
          </Box>
        </>
      ) : null}

      <TasksAffairTimeline detail={detail} />

      {detail.currentJob ? <TasksJobProgress job={detail.currentJob} /> : null}

      {detail.status === "waiting_acceptance" ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          电脑端这轮执行已结束。请按完成标准确认；你接受结果后，事务才会关闭。
        </Alert>
      ) : null}

      {detail.status === "blocked" ? (
        <Alert severity="warning" sx={{ mt: 2 }}>
          执行遇到阻塞。可以让张老板回报现状，也可以要求继续处理或取消事务。
        </Alert>
      ) : null}

      {detail.status === "canceled" || detail.status === "closed" ? (
        <Alert severity={detail.status === "canceled" ? "warning" : "success"} sx={{ mt: 2 }}>
          {detail.status === "canceled" ? "这件事务已取消，保留在最近历史中用于核对。" : "这件事务已关闭。"}
        </Alert>
      ) : null}

      <TasksAffairActions
        affairId={detail.affairId}
        status={detail.status}
        onPause={props.onPause}
        onResume={props.onResume}
        onCancel={props.onCancel}
        onAccept={props.onAccept}
        onRequestRevision={props.onRequestRevision}
        onRequestAcceptance={props.onRequestAcceptance}
      />
    </Box>
  );
}
