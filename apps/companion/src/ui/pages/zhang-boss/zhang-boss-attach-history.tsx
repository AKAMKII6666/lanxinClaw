/**
 * 张老板页：上下文附加历史。
 *
 * 职责：展示电脑端精确文本通道的附加记录（untrusted）。
 * 不拥有：把记录当系统指令、权限、OpenClaw。
 * 副作用：无。
 */

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { ContextAttachHistoryView } from "../../../chat/views.js";

/**
 * @param props 历史列表
 * @returns JSX
 */
export function ZhangBossAttachHistory(props: {
  items: ContextAttachHistoryView[];
}): ReactElement {
  if (props.items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        尚无上下文附加记录
      </Typography>
    );
  }
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">上下文附加记录</Typography>
      <Box component="ul" sx={{ mt: 0.5, pl: 2 }}>
        {props.items.map((item) => (
          <Typography component="li" key={item.attachId} variant="body2">
            [{item.contentKind}] {item.targetLabel} · {item.deliveryLabel}：{item.text}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
