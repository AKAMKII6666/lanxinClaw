/**
 * 任务页右侧详情面板。
 *
 * 职责：展示事务目标、job 进展、blocked / waiting_acceptance 与操作入口。
 * 不拥有：affair 关闭裁决、OpenClaw、权限授予。
 * 副作用：仅通过回调提交用户意图。
 */

import Box from "@mui/material/Box";
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

      <TasksAffairTimeline detail={detail} />

      {detail.currentJob ? <TasksJobProgress job={detail.currentJob} /> : null}

      {detail.status === "waiting_acceptance" ? (
        <Typography variant="body2" color="warning.main" sx={{ mt: 2 }}>
          worker 已完成，事务处于待验收；关闭须用户明确接受，不得自动 closed。
        </Typography>
      ) : null}

      <TasksAffairActions
        affairId={detail.affairId}
        status={detail.status}
        onPause={props.onPause}
        onResume={props.onResume}
        onCancel={props.onCancel}
        onRequestAcceptance={props.onRequestAcceptance}
      />
    </Box>
  );
}
