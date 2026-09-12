/**
 * Onboarding IPC 适配器（Electron main）。
 *
 * 职责：把 OnboardingService 结果压成 bridge IPC 形状。
 * 不拥有：配置落盘细节、Gateway 进程。
 * 副作用：经 service 可能启动 Gateway；clear 时 stop gateway。
 */

import type { OnboardingIpcPort } from "../../bridge/register-ipc.js";
import type { OnboardingService } from "../../onboarding/service.js";
import { toOnboardingServiceConfig } from "./onboarding-config-map.js";

/**
 * @param input service 与可选 stop
 * @returns IPC port
 */
export function createOnboardingIpcPort(input: {
  service: OnboardingService;
  stopGateway: () => void;
}): OnboardingIpcPort {
  const { service } = input;
  return {
    getStatus: () => ({
      status: service.getStatus(),
      lastError: service.getLastError(),
    }),
    submit: async (config, options) => {
      const probe = await service.submitConfig(toOnboardingServiceConfig(config), options);
      return {
        ok: probe.ok,
        ...(probe.ok
          ? {}
          : { error: { code: probe.code, message: probe.message, retryable: false } }),
        status: {
          status: service.getStatus(),
          lastError: service.getLastError(),
        },
      };
    },
    bootstrapRuntime: async (options) => {
      const probe = await service.bootstrapRuntime(options);
      return {
        ok: probe.ok,
        ...(probe.ok
          ? {}
          : { error: { code: probe.code, message: probe.message, retryable: true } }),
        status: {
          status: service.getStatus(),
          lastError: service.getLastError(),
        },
      };
    },
    clear: () => {
      service.clear();
      input.stopGateway();
      return {
        status: service.getStatus(),
        lastError: service.getLastError(),
      };
    },
  };
}
