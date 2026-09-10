/**
 * onboarding 阶段文案。
 *
 * 职责：把 phase id 映射为用户可见中文。
 * 不拥有：IPC / 探针。
 * 纯函数：无副作用。
 */

import type { OnboardingPhase } from "../../../bridge/contract.js";

/** 阶段默认文案 */
export const ONBOARDING_PHASE_LABELS: Record<OnboardingPhase, string> = {
  verifying_key: "正在验证 API Key…",
  starting_runtime: "正在启动 OpenClaw 运行时（首次可能需要数分钟，请保持网络连接）…",
};

/**
 * @param phase 阶段
 * @returns 文案
 */
export function labelOfOnboardingPhase(phase: OnboardingPhase): string {
  return ONBOARDING_PHASE_LABELS[phase];
}
