/**
 * 模型 provider key 可达性探针。
 */

import type { OnboardingConfig, ProbeResult } from "../types.js";

/**
 * 探针 provider key：对 openai 兼容端点调用 /models。
 *
 * @param config 用户配置
 * @returns 结果
 */
export async function probeProviderKey(config: OnboardingConfig): Promise<ProbeResult> {
  if (config.provider === "local") {
    return { ok: true };
  }
  const endpoint = normalizeEndpoint(config.endpoint, config.provider);
  if (!endpoint) {
    return { ok: false, code: "provider_endpoint_missing", message: "缺少模型端点" };
  }
  if (!config.apiKey.trim()) {
    return { ok: false, code: "provider_key_missing", message: "缺少模型 API key" };
  }
  try {
    const response = await fetch(`${endpoint}/models`, {
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const regionHint =
          config.provider === "qwen" ? "；请确认 API Key 与所选地域一致" : "";
        return {
          ok: false,
          code: "provider_key_invalid",
          message: `key 无效（HTTP ${response.status}）${regionHint}`,
        };
      }
      return { ok: false, code: "provider_http_error", message: `provider 返回 HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "provider_request_failed";
    return { ok: false, code: "provider_unreachable", message };
  }
}

/**
 * 规范化 provider 端点。
 *
 * @param endpoint 用户端点
 * @param provider provider
 * @returns 基础端点或 null
 */
function normalizeEndpoint(
  endpoint: string | null,
  provider: OnboardingConfig["provider"],
): string | null {
  const raw = endpoint?.trim();
  if (raw) {
    return raw.replace(/\/+$/, "");
  }
  if (provider === "openai") {
    return "https://api.openai.com/v1";
  }
  if (provider === "anthropic") {
    return "https://api.anthropic.com/v1";
  }
  return null;
}
