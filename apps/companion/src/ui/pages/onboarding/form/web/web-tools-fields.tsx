/**
 * onboarding 可选网页能力表单字段。
 *
 * 职责：勾选 web_search / browser 与搜索 key 输入。
 * 不拥有：提交、探针、密钥落盘。
 */

import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";

/** 字段 props */
export interface WebToolsFieldsProps {
  locked: boolean;
  enableWebSearch: boolean;
  enableBrowser: boolean;
  webSearchApiKey: string;
  onEnableWebSearchChange: (next: boolean) => void;
  onEnableBrowserChange: (next: boolean) => void;
  onWebSearchApiKeyChange: (next: string) => void;
}

/**
 * @param props 字段状态
 * @returns JSX
 */
export function WebToolsFields(props: WebToolsFieldsProps): ReactElement {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">可选：OpenClaw 网页能力（默认关闭）</Typography>
      <FormControlLabel
        control={
          <Checkbox
            checked={props.enableWebSearch}
            disabled={props.locked}
            onChange={(event) => props.onEnableWebSearchChange(event.target.checked)}
          />
        }
        label="启用网页搜索（web_search）；仍需每次 job 桌面授权"
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={props.enableBrowser}
            disabled={props.locked}
            onChange={(event) => props.onEnableBrowserChange(event.target.checked)}
          />
        }
        label="启用浏览器工具（browser）；仍需每次 job 桌面授权"
      />
      {props.enableWebSearch ? (
        <TextField
          label="Brave Search API Key（可选，加密存储，不入 openclaw.json）"
          type="password"
          value={props.webSearchApiKey}
          disabled={props.locked}
          onChange={(event) => props.onWebSearchApiKeyChange(event.target.value)}
          helperText="也可稍后在环境变量 BRAVE_API_KEY 中提供"
        />
      ) : null}
    </Stack>
  );
}
