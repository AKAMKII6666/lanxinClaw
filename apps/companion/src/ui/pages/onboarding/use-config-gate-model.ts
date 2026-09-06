/**
 * 配置门本地表单状态 hook。
 *
 * 职责：字段 state 与提交流程；不含 JSX。
 */

import { useEffect, useState } from "react";
import type { OnboardingPhase, OnboardingSubmitPayload } from "../../../bridge/contract.js";
import { QWEN_DEFAULT_MODEL_ID, QWEN_DEFAULT_REGION_ID } from "../../../onboarding/presets/qwen.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { executeConfigGateSubmit } from "./run-config-gate-submit.js";
import { useWebToolsFormState } from "./use-web-tools-form-state.js";

const DEFAULT_MODEL_REF: Record<string, string> = {
  qwen: "qwen/qwen3.7-plus",
  openai: "openai/gpt-5.5",
  anthropic: "anthropic/claude-sonnet-4-5",
  "openai-compatible": "custom/chat",
  local: "custom/local",
};

type OnboardingProvider = OnboardingSubmitPayload["provider"];

/** hook 返回值 */
export interface ConfigGateModel {
  provider: OnboardingProvider;
  apiKey: string;
  endpoint: string;
  modelRef: string;
  qwenRegion: string;
  qwenModel: string;
  qwenAdvancedOpen: boolean;
  qwenWorkspaceId: string;
  enableWebSearch: boolean;
  enableBrowser: boolean;
  webSearchApiKey: string;
  submitting: boolean;
  phase: OnboardingPhase;
  error: string | null;
  needsEndpoint: boolean;
  needsKey: boolean;
  changeProvider: (next: OnboardingProvider) => void;
  setApiKey: (next: string) => void;
  setEndpoint: (next: string) => void;
  setModelRef: (next: string) => void;
  setQwenRegion: (next: string) => void;
  setQwenModel: (next: string) => void;
  setQwenAdvancedOpen: (next: boolean) => void;
  setQwenWorkspaceId: (next: string) => void;
  setEnableWebSearch: (next: boolean) => void;
  setEnableBrowser: (next: boolean) => void;
  setWebSearchApiKey: (next: string) => void;
  submit: () => Promise<void>;
}

/**
 * @param bridge bridge
 * @param onConfigured 成功回调
 * @returns 表单模型
 */
export function useConfigGateModel(
  bridge: RendererBridgeApi,
  onConfigured: () => void,
): ConfigGateModel {
  const [provider, setProvider] = useState<OnboardingProvider>("qwen");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [modelRef, setModelRef] = useState<string>(DEFAULT_MODEL_REF.qwen ?? "qwen/qwen3.7-plus");
  const [qwenRegion, setQwenRegion] = useState(QWEN_DEFAULT_REGION_ID);
  const [qwenModel, setQwenModel] = useState(QWEN_DEFAULT_MODEL_ID);
  const [qwenAdvancedOpen, setQwenAdvancedOpen] = useState(false);
  const [qwenWorkspaceId, setQwenWorkspaceId] = useState("");
  const webTools = useWebToolsFormState();
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<OnboardingPhase>("verifying_key");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => bridge.onboarding.subscribeProgress(setPhase), [bridge]);

  return {
    provider,
    apiKey,
    endpoint,
    modelRef,
    qwenRegion,
    qwenModel,
    qwenAdvancedOpen,
    qwenWorkspaceId,
    enableWebSearch: webTools.enableWebSearch,
    enableBrowser: webTools.enableBrowser,
    webSearchApiKey: webTools.webSearchApiKey,
    submitting,
    phase,
    error,
    needsEndpoint: provider === "openai-compatible" || provider === "local",
    needsKey: provider !== "local",
    changeProvider(next) {
      if (submitting) return;
      setProvider(next);
      setModelRef(DEFAULT_MODEL_REF[next] ?? DEFAULT_MODEL_REF.openai ?? "openai/gpt-5.5");
      setError(null);
    },
    setApiKey,
    setEndpoint,
    setModelRef,
    setQwenRegion,
    setQwenModel,
    setQwenAdvancedOpen,
    setQwenWorkspaceId,
    setEnableWebSearch: webTools.setEnableWebSearch,
    setEnableBrowser: webTools.setEnableBrowser,
    setWebSearchApiKey: webTools.setWebSearchApiKey,
    async submit() {
      if (submitting) return;
      setSubmitting(true);
      setPhase("verifying_key");
      setError(null);
      await executeConfigGateSubmit(
        {
          bridge,
          provider,
          apiKey,
          endpoint,
          modelRef,
          qwenRegion,
          qwenModel,
          qwenAdvancedOpen,
          qwenWorkspaceId,
          enableWebSearch: webTools.enableWebSearch,
          enableBrowser: webTools.enableBrowser,
          webSearchApiKey: webTools.webSearchApiKey,
        },
        setError,
        onConfigured,
      );
      setSubmitting(false);
    },
  };
}
