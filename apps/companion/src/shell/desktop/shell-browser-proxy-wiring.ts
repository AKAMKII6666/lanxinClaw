/**
 * 桌面壳：托管浏览器本地代理偏好接线。
 *
 * 职责：解析 URL、持久化 shell-settings、在配置门 ready 时 ensureStarted 热重启。
 * 不拥有：Electron 窗口、权限裁决、托盘。
 * 副作用：写 shell-settings；可能重启 Gateway。
 */

import type { OnboardingConfig } from "../../onboarding/types.js";
import type { GatewayRuntimeService } from "../../gateway-runtime/service.js";
import type { JobDelegator } from "../../jobs/delegation/delegator.js";
import type { CompanionShellSettings } from "./shell-settings.js";
import { DEFAULT_BROWSER_PROXY_URL, parseBrowserProxyUrl } from "./shell-settings.js";

/** 有在途执行时禁止代理热重启 */
export const JOBS_RUNNING_PROXY_RESTART_BLOCKED = "jobs_running_proxy_restart_blocked";

/**
 * 构造 settings.setBrowserProxy 的执行器。
 *
 * @param input 壳侧依赖与可变偏好
 * @returns 异步应用函数
 */
export function createSetBrowserProxyHandler(input: {
  getShellPrefs: () => CompanionShellSettings;
  persistShellPrefs: (next: CompanionShellSettings) => void;
  getOnboardingConfig: () => OnboardingConfig | null;
  isOnboardingReady: () => boolean;
  gatewayService: GatewayRuntimeService | null;
  workspace: string;
  getDelegator: () => JobDelegator | null;
  /** 是否存在 running（或已授权待跑）job；有则禁止写盘与热重启 */
  hasRunningJobs?: () => boolean;
}): (
  enabled: boolean,
  url: string,
) => Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  return async (enabled, url) => {
    if (input.hasRunningJobs?.()) {
      return {
        ok: false,
        code: JOBS_RUNNING_PROXY_RESTART_BLOCKED,
        message: "有任务正在执行，请先完成或取消后再应用浏览器代理（避免重启误杀在途任务）",
      };
    }
    const resolvedUrl = resolveProxyUrlForSave(enabled, url);
    if (!resolvedUrl.ok) {
      return resolvedUrl;
    }
    input.persistShellPrefs({
      ...input.getShellPrefs(),
      browserProxyEnabled: enabled,
      browserProxyUrl: resolvedUrl.url,
    });
    await restartGatewayIfReady(input, enabled, resolvedUrl.url);
    return { ok: true };
  };
}

/**
 * 开启时严格校验；关闭时脏输入回退默认，避免关不掉。
 *
 * @param enabled 是否开启代理
 * @param url 用户输入
 * @returns 规范化 URL 或错误
 */
function resolveProxyUrlForSave(
  enabled: boolean,
  url: string,
): { ok: true; url: string } | { ok: false; code: string; message: string } {
  const parsed = parseBrowserProxyUrl(url.trim() || DEFAULT_BROWSER_PROXY_URL);
  if (parsed.ok) {
    return parsed;
  }
  if (!enabled) {
    return { ok: true, url: DEFAULT_BROWSER_PROXY_URL };
  }
  return parsed;
}

/**
 * 配置门 ready 时按新代理偏好热重启 Gateway。
 *
 * @param input 壳依赖
 * @param enabled 是否开启
 * @param proxyUrl 规范化 URL
 */
async function restartGatewayIfReady(
  input: {
    getOnboardingConfig: () => OnboardingConfig | null;
    isOnboardingReady: () => boolean;
    gatewayService: GatewayRuntimeService | null;
    workspace: string;
    getDelegator: () => JobDelegator | null;
  },
  enabled: boolean,
  proxyUrl: string,
): Promise<void> {
  const stored = input.getOnboardingConfig();
  const gateway = input.gatewayService;
  if (!gateway || !stored || !input.isOnboardingReady()) {
    return;
  }
  const handle = await gateway.ensureStarted({
    provider: stored.provider,
    apiKey: stored.apiKey,
    endpoint: stored.endpoint,
    modelRef: stored.modelRef,
    workspace: input.workspace,
    enableWebSearch: false,
    enableBrowser: true,
    webSearchApiKey: stored.webSearchApiKey ?? "",
    browserProxyEnabled: enabled,
    browserProxyUrl: proxyUrl,
  });
  input.getDelegator()?.setAdapter(handle.adapter);
}
