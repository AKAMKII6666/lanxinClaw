/**
 * 任务详情事务脉络时间线。
 *
 * 职责：渲染 timeline / blocker / resume / 验收结果。
 * 不拥有：affair 关闭、OpenClaw、权限。
 * 副作用：无。
 */

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { AffairDetailView } from "../../tasks-models.js";

/**
 * @param props 详情片段
 * @returns 脉络 JSX
 */
export function TasksAffairTimeline(props: {
  detail: AffairDetailView;
}): ReactElement {
  const { detail } = props;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">事务脉络</Typography>
      <Box component="ul" sx={{ mt: 0.5, pl: 2 }}>
        {detail.timeline.map((entry) => (
          <Typography component="li" key={entry.entryId} variant="body2">
            [{entry.kind}] {entry.summary}
          </Typography>
        ))}
      </Box>

      {detail.blockerSummary ? (
        <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
          当前阻塞：{detail.blockerSummary}
        </Typography>
      ) : null}

      {detail.resumeCondition ? (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          恢复条件：{detail.resumeCondition}
        </Typography>
      ) : null}

      {detail.acceptanceResult ? (
        <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
          验收：{detail.acceptanceResult}
        </Typography>
      ) : null}
    </Box>
  );
}
