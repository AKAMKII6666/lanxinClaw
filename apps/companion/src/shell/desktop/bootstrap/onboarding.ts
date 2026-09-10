/** 启动配置与运行时探针装配；模型验证成功后把真实 adapter 交给委派器。 */
import type { Logger } from "pino";
import type { OpenClawAdapter } from "@lanxin-claw/openclaw-adapter";
import type { GatewayRuntimeService } from "../../../gateway-runtime/service.js";
import type { JobDelegator } from "../../../jobs/delegation/delegator.js";
import { createGatewayRuntimeReadyProbe } from "../../../onboarding/probe/runtime-probe.js";
import { OnboardingService } from "../../../onboarding/service.js";
import type { OnboardingStore } from "../../../onboarding/store/store.js";
import { createOnboardingIpcPort } from "../onboarding-ipc-port.js";
import type { ShellPrefsState } from "../shell-prefs-state.js";

export function createShellOnboarding(input: {
  store: OnboardingStore;
  logger: Logger;
  gateway: GatewayRuntimeService | null;
  workspace: string;
  prefs: ShellPrefsState;
  getDelegator: () => JobDelegator | null;
  onRuntimeReady: (adapter: OpenClawAdapter) => Promise<void>;
}) {
  const service = new OnboardingService({
    store: input.store, logger: input.logger,
    runtimeReadyProbe: async () => {
      const stored = input.store.load();
      if (!stored) return { ok: false, code: "onboarding_config_missing", message: "缺少模型配置" };
      if (!input.gateway) return { ok: false, code: "gateway_runtime_unavailable", message: "未配置 OpenClaw 运行时" };
      const prefs = input.prefs.getPrefs();
      const handle = await input.gateway.ensureStarted({
        provider: stored.provider, apiKey: stored.apiKey, endpoint: stored.endpoint, modelRef: stored.modelRef,
        workspace: input.workspace, enableWebSearch: false, enableBrowser: true,
        webSearchApiKey: stored.webSearchApiKey ?? "", browserProxyEnabled: prefs.browserProxyEnabled,
        browserProxyUrl: prefs.browserProxyUrl,
      });
      input.getDelegator()?.setAdapter(handle.adapter);
      const result = await createGatewayRuntimeReadyProbe({ gatewayUrl: handle.url, token: handle.token })();
      if (result.ok) await input.onRuntimeReady(handle.adapter);
      return result;
    },
  });
  const ipc = createOnboardingIpcPort({ service, stopGateway: () => { void input.gateway?.stop(); } });
  return { onboardingService: service, onboardingIpc: ipc };
}
