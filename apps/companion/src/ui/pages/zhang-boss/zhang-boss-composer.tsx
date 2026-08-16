/**
 * 张老板页输入与提交区。
 *
 * 职责：收集路径/日志/URL，经回调提交到 companion backend。
 * 不拥有：权限授予、把文本当系统指令、OpenClaw。
 * 副作用：onSend / onAttach 回调。
 */

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { ReactElement } from "react";
import type { ChatContentKind } from "../../../chat/views.js";
import { CONTENT_KIND_LABEL } from "./zhang-boss-labels.js";

const CONTENT_KINDS: ChatContentKind[] = ["path", "log", "url", "note"];

/**
 * @param props 草稿与提交回调
 * @returns 输入区 JSX
 */
export function ZhangBossComposer(props: {
  draft: string;
  contentKind: ChatContentKind;
  canAttachAffair: boolean;
  onDraftChange: (value: string) => void;
  onContentKindChange: (value: ChatContentKind) => void;
  onSendMessage: () => void;
  onAttachActiveCall: () => void;
  onAttachAffair: () => void;
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
      <TextField
        select
        size="small"
        label="内容种类"
        value={props.contentKind}
        onChange={(event) => props.onContentKindChange(event.target.value as ChatContentKind)}
        sx={{ mt: 1.5, minWidth: 140 }}
      >
        {CONTENT_KINDS.map((kind) => (
          <MenuItem key={kind} value={kind}>
            {CONTENT_KIND_LABEL[kind]}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
        <Button variant="contained" disabled={disabled} onClick={props.onSendMessage}>
          发送给张老板
        </Button>
        <Button variant="outlined" disabled={disabled} onClick={props.onAttachActiveCall}>
          附加到当前通话
        </Button>
        <Button
          variant="outlined"
          disabled={disabled || !props.canAttachAffair}
          onClick={props.onAttachAffair}
        >
          附加到指定事务
        </Button>
      </Stack>
    </Box>
  );
}
