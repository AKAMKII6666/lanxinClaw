/**
 * onboarding 提交载荷校验与规范化。
 *
 * 职责：renderer IPC 入参校验。
 * 不拥有：探针、持久化。
 * 纯函数：无 I/O。
 */

import type { BridgeError, OnboardingSubmitPayload } from "./contract.js";
import { validateQwenOnboardingFields } from "../onboarding/presets/qwen.js";

const ONBOARDING_PROVIDERS = ["qwen", "openai", "anthropic", "openai-compatible", "local"] as const;

const ENDPOINT_REQUIRED = new Set<OnboardingSubmitPayload["provider"]>([
  "qwen",
  "openai-compatible",
  "local",
]);

/**
 * 构造 onboarding 校验错误。
 *
 * @param message 错误信息
 * @returns 失败结果
 */
function onboardingInvalid(message: string): { ok: false; error: BridgeError } {
  return { ok: false, error: { code: "onboarding_invalid", message, retryable: false } };
}

/**
 * 校验 provider 字段。
 *
 * @param provider 候选
 * @returns 是否合法
 */
function isKnownProvider(provider: unknown): provider is OnboardingSubmitPayload["provider"] {
  return typeof provider === "string" && (ONBOARDING_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * 校验基础字段；失败返回错误文案。
 *
 * @param typed 候选
 * @returns 错误文案或 null
 */
function validateOnboardingCoreFields(typed: OnboardingSubmitPayload): string | null {
  if (!isKnownProvider(typed.provider)) {
    return "未知 provider";
  }
  if (typeof typed.modelRef !== "string" || !typed.modelRef.trim()) {
    return "缺少模型引用";
  }
  if (typeof typed.apiKey !== "string") {
    return "缺少 API key";
  }
  if (typed.provider !== "local" && !typed.apiKey.trim()) {
    return "缺少 API key";
  }
  const endpoint = typeof typed.endpoint === "string" ? typed.endpoint.trim() : "";
  if (ENDPOINT_REQUIRED.has(typed.provider) && !endpoint) {
    return "缺少模型端点";
  }
  if (typed.provider === "qwen") {
    const qwenCheck = validateQwenOnboardingFields(endpoint, typed.modelRef.trim());
    if (!qwenCheck.ok) {
      return qwenCheck.message;
    }
  }
  return null;
}

/**
 * 组装网页能力可选字段。
 *
 * @param typed 候选
 * @returns 网页字段切片
 */
function pickWebToolsFields(typed: OnboardingSubmitPayload): Partial<OnboardingSubmitPayload> {
  const out: Partial<OnboardingSubmitPayload> = {
    enableWebSearch: typed.enableWebSearch === true,
    enableBrowser: typed.enableBrowser === true,
  };
  if (typeof typed.webSearchApiKey === "string" && typed.webSearchApiKey.trim()) {
    out.webSearchApiKey = typed.webSearchApiKey.trim();
  }
  return out;
}

/**
 * 校验并规范化 onboarding 提交载荷。
 *
 * @param config 候选
 * @returns 规范化配置或错误
 */
export function normalizeOnboardingPayload(
  config: unknown,
): { ok: true; value: OnboardingSubmitPayload } | { ok: false; error: BridgeError } {
  if (!config || typeof config !== "object") {
    return onboardingInvalid("配置格式无效");
  }
  const typed = config as OnboardingSubmitPayload;
  const coreError = validateOnboardingCoreFields(typed);
  if (coreError) {
    return onboardingInvalid(coreError);
  }
  const endpoint = typeof typed.endpoint === "string" ? typed.endpoint.trim() : "";
  return {
    ok: true,
    value: {
      provider: typed.provider,
      apiKey: typed.apiKey,
      modelRef: typed.modelRef.trim(),
      ...(endpoint ? { endpoint } : {}),
      ...pickWebToolsFields(typed),
    },
  };
}
