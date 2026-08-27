/**
 * 首次启动配置表单 UI。
 *
 * 职责：字段展示与提交按钮；不含 IPC 调用。
 * 不拥有：探针、key 落盘。
 */

import Alert from "@mui/material/Alert";
import Backdrop from "@mui/material/Backdrop";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import type { OnboardingPhase, OnboardingSubmitPayload } from "../../../../bridge/contract.js";
import { labelOfOnboardingPhase } from "../phase-labels.js";
import { ConfigFormFields } from "./config-form-fields.js";

type OnboardingProvider = OnboardingSubmitPayload["provider"];

/** 配置表单 props */
export interface ConfigFormProps {
  provider: OnboardingProvider;
  apiKey: string;
  endpoint: string;
  modelRef: string;
  qwenRegion: string;
  qwenModel: string;
  qwenAdvancedOpen: boolean;
  qwenWorkspaceId: string;
  submitting: boolean;
  /** 提交中阶段文案 */
  phase: OnboardingPhase;
  error: string | null;
  needsEndpoint: boolean;
  needsKey: boolean;
  onProviderChange: (next: OnboardingProvider) => void;
  onApiKeyChange: (next: string) => void;
  onEndpointChange: (next: string) => void;
  onModelRefChange: (next: string) => void;
  onQwenRegionChange: (next: string) => void;
  onQwenModelChange: (next: string) => void;
  onQwenAdvancedOpenChange: (next: boolean) => void;
  onQwenWorkspaceIdChange: (next: string) => void;
  onSubmit: () => void;
}

/**
 * 配置表单（字段 + 提交 + 错误展示）。
 *
 * @param props 表单状态与回调
 * @returns JSX
 */
export function ConfigForm(props: ConfigFormProps): ReactElement {
  const isQwen = props.provider === "qwen";
  const locked = props.submitting;

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default", p: 2 }}>
      <Card sx={{ maxWidth: 520, width: "100%", position: "relative" }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            配置澜星 Claw
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            {isQwen
              ? "连接阿里云百炼千问，验证通过后才会启动 OpenClaw 运行时。"
              : "首次使用需要配置模型服务，验证通过后才会启动 OpenClaw 运行时。"}
          </Typography>
          <ConfigFormFields
            provider={props.provider}
            apiKey={props.apiKey}
            endpoint={props.endpoint}
            modelRef={props.modelRef}
            qwenRegion={props.qwenRegion}
            qwenModel={props.qwenModel}
            qwenAdvancedOpen={props.qwenAdvancedOpen}
            qwenWorkspaceId={props.qwenWorkspaceId}
            locked={locked}
            needsEndpoint={props.needsEndpoint}
            needsKey={props.needsKey}
            onProviderChange={props.onProviderChange}
            onApiKeyChange={props.onApiKeyChange}
            onEndpointChange={props.onEndpointChange}
            onModelRefChange={props.onModelRefChange}
            onQwenRegionChange={props.onQwenRegionChange}
            onQwenModelChange={props.onQwenModelChange}
            onQwenAdvancedOpenChange={props.onQwenAdvancedOpenChange}
            onQwenWorkspaceIdChange={props.onQwenWorkspaceIdChange}
          />
          {props.error ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {props.error}
            </Alert>
          ) : null}
          <Button variant="contained" onClick={props.onSubmit} disabled={locked} sx={{ mt: 2 }}>
            保存并启动
          </Button>
        </CardContent>
        <Backdrop
          open={locked}
          sx={{
            position: "absolute",
            zIndex: (theme) => theme.zIndex.modal,
            borderRadius: 1,
            color: "common.white",
            flexDirection: "column",
            gap: 2,
            bgcolor: "rgba(0,0,0,0.55)",
          }}
        >
          <CircularProgress color="inherit" />
          <Typography variant="body1" sx={{ px: 3, textAlign: "center" }}>
            {labelOfOnboardingPhase(props.phase)}
          </Typography>
        </Backdrop>
      </Card>
    </Box>
  );
}
