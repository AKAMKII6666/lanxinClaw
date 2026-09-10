/**
 * 张老板页输入与提交区。
 *
 * 职责：收集用户文字，经回调提交到 companion backend。
 * 不拥有：权限授予、把文本当系统指令、OpenClaw。
 * 副作用：onSend 回调。
 */

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { ReactElement } from "react";


/**
 * @param props 草稿与提交回调
 * @returns 输入区 JSX
 */
export function ZhangBossComposer(props: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSendMessage: () => void;
}): ReactElement {
  const disabled = props.draft.trim().length === 0;
  return (
    <Box>
      <TextField
        fullWidth
        multiline
        minRows={3}
        label="粘贴路径、日志、URL 或说明"
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
        <Button variant="contained" disabled={disabled} onClick={props.onSendMessage}>
          发送给张老板
        </Button>
      </Stack>
    </Box>
  );
}
