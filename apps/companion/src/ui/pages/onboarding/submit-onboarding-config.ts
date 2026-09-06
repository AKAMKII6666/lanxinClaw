/**
 * 配置门提交步骤（无 React）。
 *
 * 职责：组装 payload 并调用 bridge submit。
 * 不拥有：UI 状态。
 */

import type { OnboardingSubmitPayload, OnboardingSubmitResult } from "../../../bridge/contract.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { buildSubmitPayload } from "./build-submit-payload.js";

/** 千问表单切片 */
export interface QwenSubmitFormSlice {
  apiKey: string;
  regionId: string;
  modelId: string;
  advancedOpen: boolean;
  workspaceId: string;
  enableWebSearch?: boolean;
  enableBrowser?: boolean;
  webSearchApiKey?: string;
}

/** 通用表单切片 */
export interface GenericSubmitFormSlice {
  apiKey: string;
  endpoint: string;
  modelRef: string;
  enableWebSearch?: boolean;
  enableBrowser?: boolean;
  webSearchApiKey?: string;
}

/**
 * 组装并提交 onboarding 配置。
 *
 * @param bridge 渲染层 bridge
 * @param provider 模型服务标识
 * @param qwen 千问字段
 * @param generic 通用字段
 * @returns 组装失败文案或 submit 结果
 */
export async function submitOnboardingConfig(
  bridge: RendererBridgeApi,
  provider: OnboardingSubmitPayload["provider"],
  qwen: QwenSubmitFormSlice,
  generic: GenericSubmitFormSlice,
): Promise<{ ok: true; result: OnboardingSubmitResult } | { ok: false; message: string }> {
  const built = buildSubmitPayload(provider, qwen, generic);
  if (!built.ok) {
    return { ok: false, message: built.message };
  }
  const result = await bridge.onboarding.submit(built.value);
  return { ok: true, result };
}
