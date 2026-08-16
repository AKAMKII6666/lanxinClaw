/**
 * 总览页紧凑状态卡。
 *
 * 职责：展示标题、状态、说明与主操作按钮。
 * 不拥有：bridge 调用细节、权限裁决。
 * 副作用：仅触发 onAction 回调。
 */

import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";

/**
 * 状态卡属性。
 */
export interface StatusCardProps {
  /** 卡片标题 */
  title: string;
  /** 状态主文案 */
  statusLabel: string;
  /** 辅助说明；可空 */
  message: string | null;
  /** 主按钮文案 */
  actionLabel: string;
  /** 点击主操作 */
  onAction: () => void;
}

/**
 * 渲染一张总览状态卡。
 *
 * @param props 展示与回调
 * @returns 卡片 JSX
 */
export function StatusCard(props: StatusCardProps): ReactElement {
  return (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ flex: 1 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {props.title}
        </Typography>
        <Chip label={props.statusLabel} size="small" color="default" sx={{ mb: 1 }} />
        {props.message ? (
          <Typography variant="body2" color="text.secondary">
            {props.message}
          </Typography>
        ) : null}
      </CardContent>
      <CardActions>
        <Button size="small" onClick={props.onAction}>
          {props.actionLabel}
        </Button>
      </CardActions>
    </Card>
  );
}
