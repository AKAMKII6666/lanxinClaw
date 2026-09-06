/**
 * 配置门提交执行（从 hook 拆出以降复杂度）。
 */

import type { OnboardingSubmitPayload } from "../../../bridge/contract.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { submitOnboardingConfig } from "./submit-onboarding-config.js";

/** 提交入参 */
export interface RunConfigGateSubmitInput {
  bridge: RendererBridgeApi;
  provider: OnboardingSubmitPayload["provider"];
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
}

/**
 * @param input 表单切片
 * @returns 成功或错误文案
 */
export async function runConfigGateSubmit(
  input: RunConfigGateSubmitInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const webSlice = {
    enableWebSearch: input.enableWebSearch,
    enableBrowser: input.enableBrowser,
    webSearchApiKey: input.webSearchApiKey,
  };
  const outcome = await submitOnboardingConfig(
    input.bridge,
    input.provider,
    {
      apiKey: input.apiKey,
      regionId: input.qwenRegion,
      modelId: input.qwenModel,
      advancedOpen: input.qwenAdvancedOpen,
      workspaceId: input.qwenWorkspaceId,
      ...webSlice,
    },
    {
      apiKey: input.apiKey,
      endpoint: input.endpoint,
      modelRef: input.modelRef,
      ...webSlice,
    },
  );
  if (!outcome.ok) {
    return { ok: false, message: outcome.message };
  }
  if (!outcome.result.ok) {
    return { ok: false, message: outcome.result.error?.message ?? "配置失败，请检查后重试" };
  }
  return { ok: true };
}

/**
 * hook 内提交包装：写 error 或触发成功回调。
 *
 * @param fields 提交字段
 * @param setError 错误 setter
 * @param onConfigured 成功回调
 */
export async function executeConfigGateSubmit(
  fields: RunConfigGateSubmitInput,
  setError: (message: string | null) => void,
  onConfigured: () => void,
): Promise<void> {
  try {
    const outcome = await runConfigGateSubmit(fields);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    onConfigured();
  } catch {
    setError("提交失败：主进程未响应，请重启 Companion");
  }
}
