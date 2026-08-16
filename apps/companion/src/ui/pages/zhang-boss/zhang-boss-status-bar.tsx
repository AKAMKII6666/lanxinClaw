/**
 * 张老板页状态条：在线情况与当前事务。
 *
 * 职责：展示 presence、摘要与当前 affair。
 * 不拥有：发送 chat、权限。
 * 副作用：无。
 */

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { ZhangBossPanelView } from "../../../chat/views.js";
import { AFFAIR_STATUS_LABEL } from "../overview/overview-labels.js";
import { PRESENCE_LABEL, labelOf } from "./zhang-boss-labels.js";

/**
 * @param props 面板状态
 * @returns 状态条 JSX
 */
export function ZhangBossStatusBar(props: { panel: ZhangBossPanelView }): ReactElement {
  const { panel } = props;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="subtitle1">张老板状态</Typography>
        <Chip size="small" label={PRESENCE_LABEL[panel.presence]} color="primary" variant="outlined" />
      </Box>
      {panel.summary ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {panel.summary}
        </Typography>
      ) : null}
      {panel.currentAffair ? (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="body2">
            当前上下文：{panel.currentAffair.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            状态：{labelOf(AFFAIR_STATUS_LABEL, panel.currentAffair.status)} ·{" "}
            {panel.currentAffair.progressSummary}
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          当前无进行中的事务
        </Typography>
      )}
    </Box>
  );
}
