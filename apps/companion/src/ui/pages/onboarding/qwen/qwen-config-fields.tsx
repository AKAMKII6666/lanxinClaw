/**
 * 千问 onboarding 表单字段。
 *
 * 职责：地域、模型下拉与高级 WorkspaceId。
 * 不拥有：提交与探针。
 */

import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import type { ReactElement } from "react";
import { QWEN_MODEL_PRESETS, QWEN_REGION_PRESETS, QWEN_US_VIRGINIA_REGION_ID } from "../../../../onboarding/presets/qwen.js";

/** 千问字段 props */
export interface QwenConfigFieldsProps {
  region: string;
  model: string;
  advancedOpen: boolean;
  workspaceId: string;
  /** 提交中锁定 */
  disabled?: boolean;
  onRegionChange: (next: string) => void;
  onModelChange: (next: string) => void;
  onAdvancedOpenChange: (next: boolean) => void;
  onWorkspaceIdChange: (next: string) => void;
}

/**
 * 千问专用配置字段。
 *
 * @param props 千问表单状态与回调
 * @returns JSX
 */
export function QwenConfigFields(props: QwenConfigFieldsProps): ReactElement {
  const isUsVirginia = props.region === QWEN_US_VIRGINIA_REGION_ID;
  const locked = props.disabled === true;

  return (
    <>
      <TextField
        select
        label="服务地域"
        value={props.region}
        disabled={locked}
        onChange={(event) => props.onRegionChange(event.target.value)}
        helperText="API Key 须与所选地域匹配"
      >
        {QWEN_REGION_PRESETS.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="模型"
        value={props.model}
        disabled={locked}
        onChange={(event) => props.onModelChange(event.target.value)}
      >
        {QWEN_MODEL_PRESETS.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      <Button
        size="small"
        disabled={locked}
        onClick={() => props.onAdvancedOpenChange(!props.advancedOpen)}
        sx={{ alignSelf: "flex-start", textTransform: "none" }}
      >
        {props.advancedOpen ? "收起高级选项" : "高级：业务空间专属域名"}
      </Button>
      <Collapse in={props.advancedOpen}>
        <TextField
          fullWidth
          label="WorkspaceId"
          value={props.workspaceId}
          onChange={(event) => props.onWorkspaceIdChange(event.target.value)}
          disabled={locked || isUsVirginia}
          helperText={
            isUsVirginia
              ? "美国（弗吉尼亚）暂无业务空间专属域名，已使用共享 endpoint"
              : "填写业务空间 ID；须与所选地域匹配"
          }
        />
      </Collapse>
    </>
  );
}
