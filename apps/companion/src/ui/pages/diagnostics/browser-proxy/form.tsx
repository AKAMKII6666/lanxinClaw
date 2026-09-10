/** 浏览器代理表单展示；配置验证和提交由偏好宿主负责。 */
import Box from "@mui/material/Box";
import type { ReactElement } from "react";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";

/**
 * @param props 表单控件
 * @returns 开关/地址/按钮
 */
export function BrowserProxyFormFields(props: {
  enabled: boolean;
  url: string;
  saving: boolean;
  urlError: string | null;
  onEnabledChange: (next: boolean) => void;
  onUrlChange: (next: string) => void;
  onApply: () => void;
}): ReactElement {
  return (
    <Stack spacing={2}>
      <FormControlLabel
        control={
          <Switch
            checked={props.enabled}
            onChange={(event) => props.onEnabledChange(event.target.checked)}
          />
        }
        label="托管浏览器走本地代理"
      />
      <TextField
        label="代理地址"
        size="small"
        fullWidth
        value={props.url}
        onChange={(event) => props.onUrlChange(event.target.value)}
        error={props.urlError !== null}
        helperText={
          props.urlError ?? "默认 http://127.0.0.1:7890；仅允许 127.0.0.1 / localhost（点击应用时校验）"
        }
      />
      <Box>
        <Button variant="contained" onClick={props.onApply}>
          {props.saving ? "应用中…" : "应用并重启"}
        </Button>
      </Box>
    </Stack>
  );
}
