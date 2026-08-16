/**
 * 总览「当前任务」详情面板。
 *
 * 职责：展示事务标题、状态、进展与查看详情操作。
 * 不拥有：事务状态机、OpenClaw、权限。
 * 副作用：仅 onViewDetail 回调。
 */

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { ControlPanelSnapshotView } from "../../../bridge/contract.js";
import { AFFAIR_STATUS_LABEL, labelOf } from "./overview-labels.js";

/**
 * @param props.affair 当前事务；null 表示无任务
 * @param props.onViewDetail 查看详情
 * @returns 面板 JSX
 */
export function CurrentAffairPanel(props: {
  affair: ControlPanelSnapshotView["currentAffair"];
  onViewDetail: (affairId: string) => void;
}): ReactElement {
  if (!props.affair) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            当前任务
          </Typography>
          <Typography color="text.secondary">无任务</Typography>
        </CardContent>
      </Card>
    );
  }

  const affair = props.affair;
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          当前任务
        </Typography>
        <Typography variant="subtitle1" color="text.primary">
          {affair.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          状态：{labelOf(AFFAIR_STATUS_LABEL, affair.status)}
          {affair.executor ? ` · 执行者：${affair.executor}` : ""}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          最近进展：{affair.progressSummary}
        </Typography>
        {affair.blockedReason ? (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            阻塞：{affair.blockedReason}
          </Typography>
        ) : null}
        <Box sx={{ mt: 2 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => props.onViewDetail(affair.affairId)}
          >
            查看详情
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
