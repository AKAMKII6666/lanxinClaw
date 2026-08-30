/**
 * Electron 壳层运行时接线：撤销配对与 JobDelegator 工厂。
 *
 * 职责：从 electron-main 抽离可复用的 revoke / delegator 装配。
 * 不拥有：窗口、IPC、gateway 生命周期。
 * 副作用：revoke 回调会写 identity、广播 pairing.revoked。
 */

import { createEnvelope, PROTOCOL_VERSION } from "@lanxin-claw/protocol";
import type { OpenClawAdapter } from "@lanxin-claw/openclaw-adapter";
import type { DeviceIdentityStore } from "../../credentials/identity-store.js";
import type { CompanionBackendRuntime } from "../../backend/runtime.js";
import { reconcileDelegatorOnStartup } from "../../jobs/delegation/delegator-reconcile.js";
import { JobDelegator } from "../../jobs/delegation/delegator.js";
import type { LoggerRegistry } from "../../logging/logger.js";
import type { CompanionProtocolServerHandle } from "../../protocol-server/server.js";
import { startDiscoveryAdvertiser, type StartAdvertiserResult } from "../../discovery/advertise.js";
import { selectLanMdnsInterface } from "../../discovery/lan-mdns-interface.js";
import { createBonjourMdnsTransport } from "../../discovery/transport/bonjour.js";
import type { Logger } from "pino";

/**
 * 恢复 shell 启动时的 in-flight job 轮询与 reconcile。
 *
 * @param delegator 任务委派器
 * @param backend 后端 runtime
 * @param adapter OpenClaw adapter
 */
export function restoreShellInFlightJobs(
  delegator: JobDelegator,
  backend: CompanionBackendRuntime,
  adapter: OpenClawAdapter,
): void {
  void reconcileDelegatorOnStartup(delegator, backend, adapter);
}

/**
 * 启动 LAN mDNS 广告（可选）。
 *
 * @param deps 依赖
 * @returns 是否成功启动
 */
export async function startShellLanDiscovery(deps: {
  enabled: boolean;
  protocolPort: number;
  desktopDeviceId: string;
  logger: Logger;
  onResult: (result: { lanDiscoveryReady: boolean; recentServerErrorCode?: string }) => void;
}): Promise<void> {
  if (!deps.enabled) {
    return;
  }
  const explicitInterfaceAddress = process.env.LANXIN_MDNS_INTERFACE_ADDRESS;
  const mdnsInterface = selectLanMdnsInterface(
    undefined,
    explicitInterfaceAddress !== undefined ? { explicitAddress: explicitInterfaceAddress } : {},
  );
  if (!mdnsInterface.ok) {
    deps.onResult({ lanDiscoveryReady: false, recentServerErrorCode: mdnsInterface.code });
    deps.logger.warn({ code: mdnsInterface.code }, "mDNS 广告网卡选择失败");
    return;
  }
  const transport = createBonjourMdnsTransport({
    interfaceAddress: mdnsInterface.candidate.address,
  });
  let started: StartAdvertiserResult;
  try {
    started = await startDiscoveryAdvertiser(transport, {
      instanceName: "Lanxin Companion",
      port: deps.protocolPort,
      advertisement: {
        deviceName: "Lanxin Companion",
        deviceIdHint: deps.desktopDeviceId.slice(0, 8),
        serviceVersion: "0.1.0-dev",
        protocolVersion: PROTOCOL_VERSION,
        pairingAvailable: true,
        pairedPhoneIds: [],
        capabilities: ["affair", "job", "chat"],
      },
    });
  } catch (error) {
    await transport.destroy();
    deps.onResult({
      lanDiscoveryReady: false,
      recentServerErrorCode: "mdns_advertise_start_failed",
    });
    deps.logger.warn(
      {
        code: "mdns_advertise_start_failed",
        message: error instanceof Error ? error.message : String(error),
        mdnsInterfaceAddress: mdnsInterface.candidate.address,
        mdnsInterfaceName: mdnsInterface.candidate.name,
      },
      "mDNS 广告启动异常",
    );
    return;
  }
  if (!started.ok) {
    await transport.destroy();
    deps.onResult({ lanDiscoveryReady: false, recentServerErrorCode: started.error.code });
    deps.logger.warn(
      {
        code: started.error.code,
        mdnsInterfaceAddress: mdnsInterface.candidate.address,
        mdnsInterfaceName: mdnsInterface.candidate.name,
      },
      "mDNS 广告启动失败",
    );
    return;
  }
  deps.onResult({ lanDiscoveryReady: true });
  deps.logger.info(
    {
      port: deps.protocolPort,
      mdnsInterfaceAddress: mdnsInterface.candidate.address,
      mdnsInterfaceName: mdnsInterface.candidate.name,
    },
    "mDNS 广告已启动",
  );
}


/**
 * 创建设备撤销配对回调。
 *
 * @param deps identity、协议广播与 pairingId 读取
 * @returns backend.onDeviceRevokePairing 处理器
 */
export function createDeviceRevokePairingHandler(deps: {
  identityStore: DeviceIdentityStore;
  getProtocolHandle: () => CompanionProtocolServerHandle | null;
  getPairingId: () => string | null;
  getDelegator?: () => JobDelegator | null;
  getJobAffairId?: (jobId: string) => string;
}): (input: { phoneDeviceId: string; desktopDeviceId: string }) => Promise<void> {
  return async ({ phoneDeviceId, desktopDeviceId: deskId }) => {
    const delegator = deps.getDelegator?.();
    if (delegator) {
      const activeIds = delegator.listActiveJobIds();
      delegator.stop();
      for (const jobId of activeIds) {
        try {
          await delegator.cancelJob({
            jobId,
            affairId: deps.getJobAffairId?.(jobId) ?? "",
          });
        } catch {
          // best-effort cancel
        }
      }
    }
    await deps.identityStore.revokeIdentity(
      phoneDeviceId,
      deskId,
      "user_revoke_from_desktop",
      new Date().toISOString(),
    );
    const protocolHandle = deps.getProtocolHandle();
    protocolHandle?.clearAuthenticatedSockets();
    protocolHandle?.broadcast(
      createEnvelope({
        source: { kind: "companion", deviceId: deskId },
        target: { kind: "phone", deviceId: phoneDeviceId },
        type: "pairing.revoked",
        payload: {
          pairingId: deps.getPairingId() ?? "",
          phoneDeviceId,
          desktopDeviceId: deskId,
          reason: "user_revoke_from_desktop",
          revokedAt: new Date().toISOString(),
        },
      }),
    );
  };
}

/**
 * 创建 shell 用 JobDelegator。
 *
 * @param deps 依赖
 * @returns JobDelegator 实例
 */
export function createShellJobDelegator(deps: {
  adapter: OpenClawAdapter;
  backend: CompanionBackendRuntime;
  desktopDeviceId: string;
  workspace: string;
  applyProtocolEnvelope: CompanionBackendRuntime["applyProtocolEnvelope"];
  sendEnvelope: (envelope: Parameters<CompanionProtocolServerHandle["sendEnvelope"]>[0]) => void;
  pollIntervalMs: number;
  logRegistry: LoggerRegistry;
}): JobDelegator {
  return new JobDelegator({
    adapter: deps.adapter,
    gate: deps.backend.getPermissionGate(),
    getJobStatus: (jobId) => deps.backend.getState().jobs.get(jobId)?.status,
    getWorkspaceHint: (jobId) => deps.backend.getState().jobs.get(jobId)?.workspaceHint ?? null,
    getJobPurpose: (jobId) => deps.backend.getState().jobs.get(jobId)?.purpose,
    authorizedDesktopRoot: deps.workspace,
    getAffair: (affairId) => deps.backend.getState().affairs.get(affairId),
    getPhoneDeviceId: () => deps.backend.getState().connection.phoneDeviceId ?? null,
    desktopDeviceId: deps.desktopDeviceId,
    applyProtocolEnvelope: deps.applyProtocolEnvelope,
    sendEnvelope: deps.sendEnvelope,
    pollIntervalMs: deps.pollIntervalMs,
    logger: deps.logRegistry.getLogger("adapter"),
  });
}
