/**
 * 配置门提交载荷组装。
 *
 * 职责：将 UI 状态转为 onboarding IPC payload。
 * 不拥有：探针、持久化。
 * 纯函数：无 I/O。
 */

import type { OnboardingSubmitPayload } from "../../../bridge/contract.js";
import { QWEN_US_VIRGINIA_REGION_ID, resolveQwenOnboarding } from "../../../onboarding/presets/qwen.js";

/** 千问表单输入 */
export interface QwenSubmitInput {
  apiKey: string;
  regionId: string;
  modelId: string;
  advancedOpen: boolean;
  workspaceId: string;
}

/** 通用 provider 表单输入 */
export interface GenericSubmitInput {
  provider: Exclude<OnboardingSubmitPayload["provider"], "qwen">;
  apiKey: string;
  endpoint: string;
  modelRef: string;
}

/**
 * 组装千问提交载荷。
 *
 * @param input 千问表单状态
 * @returns 载荷或错误信息
 */
export function buildQwenSubmitPayload(
  input: QwenSubmitInput,
): { ok: true; value: OnboardingSubmitPayload } | { ok: false; message: string } {
  const useWorkspace =
    input.advancedOpen &&
    input.regionId !== QWEN_US_VIRGINIA_REGION_ID &&
    input.workspaceId.trim().length > 0;
  if (
    input.advancedOpen &&
    input.regionId !== QWEN_US_VIRGINIA_REGION_ID &&
    !input.workspaceId.trim()
  ) {
    return { ok: false, message: "启用业务空间专属域名时，请填写 WorkspaceId" };
  }
  try {
    const resolved = resolveQwenOnboarding({
      regionId: input.regionId,
      modelId: input.modelId,
      workspaceId: useWorkspace ? input.workspaceId : null,
    });
    return {
      ok: true,
      value: {
        provider: "qwen",
        apiKey: input.apiKey.trim(),
        endpoint: resolved.endpoint,
        modelRef: resolved.modelRef,
      },
    };
  } catch {
    return { ok: false, message: "千问地域或模型选择无效，请重新选择" };
  }
}

/**
 * 组装非千问 provider 提交载荷。
 *
 * @param input 通用表单状态
 * @returns IPC 载荷
 */
export function buildGenericSubmitPayload(input: GenericSubmitInput): OnboardingSubmitPayload {
  return {
    provider: input.provider,
    apiKey: input.apiKey.trim(),
    ...(input.endpoint.trim() ? { endpoint: input.endpoint.trim() } : {}),
    modelRef: input.modelRef.trim(),
  };
}

/**
 * 按 provider 组装提交载荷。
 *
 * @param provider 当前 provider
 * @param qwen 千问输入
 * @param generic 通用输入（不含 provider）
 * @returns 载荷或错误信息
 */
export function buildSubmitPayload(
  provider: OnboardingSubmitPayload["provider"],
  qwen: QwenSubmitInput,
  generic: Pick<GenericSubmitInput, "apiKey" | "endpoint" | "modelRef">,
): { ok: true; value: OnboardingSubmitPayload } | { ok: false; message: string } {
  if (provider === "qwen") {
    return buildQwenSubmitPayload(qwen);
  }
  return {
    ok: true,
    value: buildGenericSubmitPayload({ ...generic, provider }),
  };
}
