/**
 * 配置门表单字段区（不含遮罩与标题）。
 */

import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { ReactElement } from "react";
import type { OnboardingSubmitPayload } from "../../../../bridge/contract.js";
import { QWEN_API_KEY_HELP_URL } from "../../../../onboarding/presets/qwen.js";
import { GenericProviderFields } from "./generic-provider-fields.js";
import { QwenConfigFields } from "../qwen/qwen-config-fields.js";
import { WebToolsFields } from "./web/web-tools-fields.js";

const PROVIDER_OPTIONS = [
  { value: "qwen", label: "千问（阿里云百炼）" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai-compatible", label: "OpenAI 兼容端点" },
  { value: "local", label: "本地模型（无 key）" },
] as const;

type OnboardingProvider = OnboardingSubmitPayload["provider"];

/** 字段区 props */
export interface ConfigFormFieldsProps {
  provider: OnboardingProvider;
  apiKey: string;
  endpoint: string;
  modelRef: string;
  qwenRegion: string;
  qwenModel: string;
  qwenAdvancedOpen: boolean;
  qwenWorkspaceId: string;
  locked: boolean;
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
export function ConfigFormFields(props: ConfigFormFieldsProps): ReactElement {
  const isQwen = props.provider === "qwen";
  return (
    <Stack spacing={2}>
      <TextField
        select
        label="模型服务"
        value={props.provider}
        disabled={props.locked}
        onChange={(event) => props.onProviderChange(event.target.value as OnboardingProvider)}
      >
        {PROVIDER_OPTIONS.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      {isQwen ? (
        <QwenConfigFields
          region={props.qwenRegion}
          model={props.qwenModel}
          advancedOpen={props.qwenAdvancedOpen}
          workspaceId={props.qwenWorkspaceId}
          disabled={props.locked}
          onRegionChange={props.onQwenRegionChange}
          onModelChange={props.onQwenModelChange}
          onAdvancedOpenChange={props.onQwenAdvancedOpenChange}
          onWorkspaceIdChange={props.onQwenWorkspaceIdChange}
        />
      ) : (
        <GenericProviderFields
          endpoint={props.endpoint}
          modelRef={props.modelRef}
          needsEndpoint={props.needsEndpoint}
          disabled={props.locked}
          onEndpointChange={props.onEndpointChange}
          onModelRefChange={props.onModelRefChange}
        />
      )}
      {props.needsKey ? (
        <TextField
          label="API Key"
          type="password"
          value={props.apiKey}
          disabled={props.locked}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
          helperText={
            isQwen ? (
              <>
                Key 会加密保存在本机，仅用于模型请求。{" "}
                <Link href={QWEN_API_KEY_HELP_URL} target="_blank" rel="noopener noreferrer">
                  去百炼控制台获取
                </Link>
              </>
            ) : (
              "Key 会加密保存在本机，仅用于模型请求"
            )
          }
        />
      ) : null}
      <WebToolsFields
        locked={props.locked}
        enableWebSearch={props.enableWebSearch}
        enableBrowser={props.enableBrowser}
        webSearchApiKey={props.webSearchApiKey}
        onEnableWebSearchChange={props.onEnableWebSearchChange}
        onEnableBrowserChange={props.onEnableBrowserChange}
        onWebSearchApiKeyChange={props.onWebSearchApiKeyChange}
      />
    </Stack>
  );
}
