/**
 * onboarding 提交配置映射（从 electron-main 拆出以降文件行数）。
 *
 * 职责：IPC payload → OnboardingConfig。
 * 不拥有：探针、Gateway。
 * 纯函数。
 */

import type { OnboardingSubmitPayload } from "../../bridge/contract.js";
import type { OnboardingConfig } from "../../onboarding/types.js";

/**
 * @param config IPC 载荷
 * @returns 服务层配置
 */
export function toOnboardingServiceConfig(config: OnboardingSubmitPayload): OnboardingConfig {
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    endpoint: config.endpoint ?? null,
    modelRef: config.modelRef,
    enableWebSearch: false,
    enableBrowser: true,
    webSearchApiKey: config.webSearchApiKey ?? "",
  };
}
