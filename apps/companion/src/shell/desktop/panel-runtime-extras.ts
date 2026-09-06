/**
 * 控制面板 snapshot / 诊断用的 Gateway 与凭据运行态。
 *
 * 职责：把 gateway / onboarding / secrets 压成投影 extras。
 * 不拥有：Gateway 进程、权限、协议。
 * 纯函数：无 I/O。
 */

import type { SnapshotProjectionExtras } from "../../state/projector.js";
import type { BuildDiagnosticReportInput } from "../../diagnostics/probes.js";

/** Gateway 运行时最小面 */
export interface GatewayStatusPort {
  isDegraded(): boolean;
  isRunning(): boolean;
  getLastRestartError(): { code?: string; message: string } | null;
  getHandle(): { url: string } | null;
  /** 可选：OpenClaw 工具能力摘要 */
  getOpenClawToolCapabilities?: () => {
    webSearch: { ready: boolean; detail: string };
    browser: { ready: boolean; detail: string };
  };
}

/**
 * @param gateway Gateway 服务；可空
 * @param onboardingReady 配置门是否 ready
 * @param secretsAvailable 安全存储是否可用
 * @returns extras
 */
export function buildGatewaySnapshotExtras(
  gateway: GatewayStatusPort | null,
  onboardingReady: boolean,
  secretsAvailable: boolean,
): SnapshotProjectionExtras {
  const running = gateway?.isRunning() ?? false;
  const degraded = gateway?.isDegraded() ?? false;
  const caps = gateway?.getOpenClawToolCapabilities?.();
  const capabilityNote = caps
    ? `；web_search=${caps.webSearch.ready ? "ready" : "off"}；browser=${caps.browser.ready ? "ready" : "off"}`
    : "";
  return {
    clawCore: {
      status: degraded ? "error" : running ? "running" : "stopped",
      version: null,
      adapterReady: running,
      message: degraded
        ? gateway?.getLastRestartError()?.message ?? "Gateway 已停止自动重启"
        : running
          ? `自托管 Gateway 运行中${capabilityNote}`
          : "OpenClaw Gateway 未就绪",
    },
    credential: {
      status: onboardingReady ? "synced" : "missing",
      provider: "openclaw-gateway",
      lastSyncedAt: onboardingReady ? new Date().toISOString() : null,
      expiresAt: null,
      message: secretsAvailable ? "凭据已加密存储" : "安全存储不可用，拒绝落盘明文",
    },
  };
}

/**
 * @param input 诊断探针输入
 * @returns diagnosticsInput 字段
 */
export function buildGatewayDiagnosticsInput(input: {
  protocolServerReady: boolean;
  lanDiscoveryReady: boolean;
  recentServerErrorCode: string | null;
  gateway: GatewayStatusPort | null;
  secretsAvailable: boolean;
}): Pick<
  BuildDiagnosticReportInput,
  | "protocolServerReady"
  | "gatewayReady"
  | "gatewayUrl"
  | "lanDiscoveryReady"
  | "secureStorageReady"
  | "recentServerErrorCode"
  | "openClawWebSearchReady"
  | "openClawBrowserReady"
  | "openClawCapabilityDetail"
> {
  const caps = input.gateway?.getOpenClawToolCapabilities?.();
  return {
    protocolServerReady: input.protocolServerReady,
    gatewayReady: input.gateway?.isRunning() ?? false,
    gatewayUrl: input.gateway?.getHandle()?.url ?? null,
    lanDiscoveryReady: input.lanDiscoveryReady,
    secureStorageReady: input.secretsAvailable,
    recentServerErrorCode:
      input.recentServerErrorCode ?? input.gateway?.getLastRestartError()?.code ?? null,
    openClawWebSearchReady: caps?.webSearch.ready ?? false,
    openClawBrowserReady: caps?.browser.ready ?? false,
    openClawCapabilityDetail: caps
      ? `webSearch=${caps.webSearch.detail}; browser=${caps.browser.detail}`
      : null,
  };
}
