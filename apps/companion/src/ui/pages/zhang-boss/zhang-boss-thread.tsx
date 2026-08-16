/**
 * 张老板页对话线程。
 *
 * 职责：按时间展示消息；文本为 untrusted，仅展示。
 * 不拥有：发送、权限、系统指令解析。
 * 副作用：无。
 */

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { ZhangBossChatMessageView } from "../../../chat/views.js";
import { AUTHOR_LABEL, labelOf } from "./zhang-boss-labels.js";

/**
 * @param props 消息列表
 * @returns 线程 JSX
 */
export function ZhangBossThread(props: { messages: ZhangBossChatMessageView[] }): ReactElement {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        mb: 2,
        minHeight: 180,
        maxHeight: 320,
        overflow: "auto",
      }}
    >
      {props.messages.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          暂无消息。可在下方粘贴路径、日志或 URL。
        </Typography>
      ) : (
        props.messages.map((msg) => (
          <Box key={msg.messageId} sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              {labelOf(AUTHOR_LABEL, msg.authorKind)}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
              {msg.text}
            </Typography>
          </Box>
        ))
      )}
    </Box>
  );
}
