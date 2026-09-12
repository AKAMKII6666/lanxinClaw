/**
 * 任务页左侧事务列表。
 *
 * 职责：展示 affair 摘要并支持选中。
 * 不拥有：详情渲染、状态机、副作用执行。
 * 副作用：仅 onSelect 回调。
 */

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { Fragment, type ReactElement } from "react";
import { AFFAIR_STATUS_LABEL, labelOf } from "./tasks-labels.js";
import type { AffairListItemView } from "./tasks-models.js";

/**
 * @param props 列表与选中回调
 * @returns 列表 JSX
 */
export function TasksListPanel(props: {
  affairs: AffairListItemView[];
  selectedAffairId: string | null;
  onSelect: (affairId: string) => void;
}): ReactElement {
  if (props.affairs.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        暂无事务
      </Typography>
    );
  }

  return (
    <List dense disablePadding>
      {props.affairs.map((item, index) => (
        <Fragment key={item.affairId}>
          {index === 0 || props.affairs[index - 1]?.groupLabel !== item.groupLabel ? (
            <Typography color="text.secondary" variant="caption" sx={{ display: "block", mt: index === 0 ? 0 : 1.5, mb: 0.5 }}>
              {item.groupLabel}
            </Typography>
          ) : null}
          <ListItemButton
            selected={item.affairId === props.selectedAffairId}
            onClick={() => props.onSelect(item.affairId)}
            sx={{ alignItems: "flex-start", mb: 1, border: 1, borderColor: "divider", borderRadius: 1 }}
          >
            <ListItemText
              primary={
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Chip
                    size="small"
                    label={labelOf(AFFAIR_STATUS_LABEL, item.status)}
                    color={item.status === "blocked" ? "error" : "default"}
                    sx={{ alignSelf: "flex-start" }}
                  />
                  <Typography variant="subtitle2">{item.title}</Typography>
                </Box>
              }
              secondary={
                item.blockedReason
                  ? `阻塞：${item.blockedReason}`
                  : `最近：${item.progressSummary}`
              }
            />
          </ListItemButton>
        </Fragment>
      ))}
    </List>
  );
}
