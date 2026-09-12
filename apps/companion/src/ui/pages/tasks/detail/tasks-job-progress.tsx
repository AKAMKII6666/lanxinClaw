/**
 * 任务详情中的当前 job 进展块。
 *
 * 职责：展示 job 状态、步骤、blocked 与 resume。
 * 不拥有：事务操作按钮、OpenClaw。
 * 纯展示：无副作用。
 */

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import { JOB_STATUS_LABEL, labelOf } from "../tasks-labels.js";
import type { JobDetailView } from "../tasks-models.js";

/**
 * @param props.job 当前 job
 * @returns job 进展 JSX
 */
export function TasksJobProgress(props: { job: JobDetailView }): ReactElement {
  const job = props.job;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">当前 job</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {job.jobId} · {labelOf(JOB_STATUS_LABEL, job.status)}
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        目标：{job.goal}
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {job.progressSummary}
      </Typography>
      {job.attemptedSteps.length > 0 ? (
        <>
          <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
            已尝试步骤
          </Typography>
          <Box component="ol" sx={{ mt: 0.5, pl: 2 }}>
            {job.attemptedSteps.map((step) => (
              <Typography component="li" key={step} variant="body2">
                {step}
              </Typography>
            ))}
          </Box>
        </>
      ) : null}
      {job.blockedReason ? (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          阻塞：{job.blockedReason}
        </Typography>
      ) : null}
      {job.resumeCondition ? (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          恢复条件：{job.resumeCondition}
        </Typography>
      ) : null}
    </Box>
  );
}
