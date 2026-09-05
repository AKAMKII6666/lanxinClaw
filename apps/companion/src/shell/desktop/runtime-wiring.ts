/**
 * Electron 壳层运行时接线：撤销配对与 JobDelegator 工厂。
 *
 * 职责：从 electron-main 抽离可复用的 revoke / delegator 装配。
 * 不拥有：窗口、IPC、gateway 生命周期。
 * 副作用：revoke 回调会写 identity、广播 pairing.revoked。
 */

import { createEnvelope, PROTOCOL_VERSION, type DiscoveryAdvertisement } from "@lanxin-claw/protocol";
import type { OpenClawAdapter } from "@lanxin-claw/openclaw-adapter";
import type { DeviceIdentityStore } from "../../credentials/identity-store.js";
import type { CompanionBackendRuntime } from "../../backend/runtime.js";
import { reconcileDelegatorOnStartup } from "../../jobs/delegation/delegator-reconcile.js";
import { JobDelegator } from "../../jobs/delegation/delegator.js";
import type { LoggerRegistry } from "../../logging/logger.js";
import type { CompanionProtocolServerHandle } from "../../protocol-server/server.js";
import { startDiscoveryAdvertiser, type StartAdvertiserResult } from "../../discovery/advertise.js";
import { selectLanMdnsInterface, type LanMdnsInterfaceSelection } from "../../discovery/lan-mdns-interface.js";
import { createBonjourMdnsTransport } from "../../discovery/transport/bonjour.js";
import type { MdnsTransport } from "../../discovery/transport/types.js";
import type { Logger } from "pino";

export interface ShellLanDiscoveryHandle {
  refresh: (pairedPhoneIds?: string[]) => Promise<void>;
  stop: () => Promise<void>;
}

export interface ShellLanDiscoveryDeps {
  enabled: boolean;
  protocolPort: number;
  desktopDeviceId: string;
  getPairedPhoneIds?: () => Promise<string[]> | string[];
  selectInterface?: () => LanMdnsInterfaceSelection;
  createTransport?: (options: { interfaceAddress: string }) => MdnsTransport;
  logger: Logger;
  onResult: (result: { lanDiscoveryReady: boolean; recentServerErrorCode?: string }) => void;
}

type SelectedLanMdnsInterface = Extract<LanMdnsInterfaceSelection, { ok: true }>["candidate"];

interface ShellLanDiscoveryState {
  deps: ShellLanDiscoveryDeps;
  mdnsInterface: SelectedLanMdnsInterface;
  transport: MdnsTransport;
  currentStop: (() => Promise<void>) | null;
  closed: boolean;
}

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
export async function startShellLanDiscovery(
  deps: ShellLanDiscoveryDeps,
): Promise<ShellLanDiscoveryHandle | null> {
  if (!deps.enabled) {
    return null;
  }
  const mdnsInterface = selectShellLanMdnsInterface(deps);
  if (!mdnsInterface.ok) {
    deps.onResult({ lanDiscoveryReady: false, recentServerErrorCode: mdnsInterface.code });
    deps.logger.warn({ code: mdnsInterface.code }, "mDNS 广告网卡选择失败");
    return null;
  }
  const transportFactory = deps.createTransport ?? createBonjourMdnsTransport;
  const transport = transportFactory({
    interfaceAddress: mdnsInterface.candidate.address,
  });
  const state: ShellLanDiscoveryState = {
    deps,
    transport,
    mdnsInterface: mdnsInterface.candidate,
    currentStop: null,
    closed: false,
  };
  const initialOk = await publishShellLanDiscovery(state);
  if (!initialOk) {
    await transport.destroy();
    return null;
  }
  return {
    refresh: async (pairedPhoneIds?: string[]) => {
      await publishShellLanDiscovery(state, pairedPhoneIds);
    },
    stop: async () => {
      state.closed = true;
      await stopCurrentDiscoveryPublication(state);
      await transport.destroy();
    },
  };
}

function selectShellLanMdnsInterface(deps: ShellLanDiscoveryDeps): LanMdnsInterfaceSelection {
  if (deps.selectInterface) {
    return deps.selectInterface();
  }
  const explicitInterfaceAddress = process.env.LANXIN_MDNS_INTERFACE_ADDRESS;
  return selectLanMdnsInterface(
    undefined,
    explicitInterfaceAddress !== undefined ? { explicitAddress: explicitInterfaceAddress } : {},
  );
}

async function resolvePairedPhoneIds(
  deps: ShellLanDiscoveryDeps,
  explicit?: string[],
): Promise<string[]> {
  const raw = explicit ?? (deps.getPairedPhoneIds ? await deps.getPairedPhoneIds() : []);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of raw) {
    const id = String(item || "").trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function createShellDiscoveryAdvertisement(
  desktopDeviceId: string,
  pairedPhoneIds: string[],
): DiscoveryAdvertisement {
  return {
    deviceName: "Lanxin Companion",
    deviceIdHint: desktopDeviceId.slice(0, 8),
    serviceVersion: "0.1.0-dev",
    protocolVersion: PROTOCOL_VERSION,
    pairingAvailable: true,
    pairedPhoneIds,
    capabilities: ["affair", "job", "chat"],
  };
}

async function stopCurrentDiscoveryPublication(state: ShellLanDiscoveryState): Promise<void> {
  if (!state.currentStop) {
    return;
  }
  await state.currentStop();
  state.currentStop = null;
}

async function publishShellLanDiscovery(
  state: ShellLanDiscoveryState,
  pairedPhoneIds?: string[],
): Promise<boolean> {
  if (state.closed) {
    return false;
  }
  const resolvedPairedPhoneIds = await resolvePairedPhoneIds(state.deps, pairedPhoneIds);
  const advertisement = createShellDiscoveryAdvertisement(
    state.deps.desktopDeviceId,
    resolvedPairedPhoneIds,
  );
  const started = await tryPublishShellLanDiscovery(state, advertisement);
  return applyShellLanDiscoveryPublishResult(state, started, resolvedPairedPhoneIds.length);
}

async function tryPublishShellLanDiscovery(
  state: ShellLanDiscoveryState,
  advertisement: DiscoveryAdvertisement,
): Promise<StartAdvertiserResult | null> {
  try {
    await stopCurrentDiscoveryPublication(state);
    state.deps.logger.info(
      createShellLanDiscoveryLogFields(state, advertisement),
      "mDNS 广告发布 DTO",
    );
    return await startDiscoveryAdvertiser(state.transport, {
      instanceName: "Lanxin Companion",
      port: state.deps.protocolPort,
      advertisement,
    });
  } catch (error) {
    state.deps.onResult({
      lanDiscoveryReady: false,
      recentServerErrorCode: "mdns_advertise_start_failed",
    });
    state.deps.logger.warn(
      {
        code: "mdns_advertise_start_failed",
        message: error instanceof Error ? error.message : String(error),
        mdnsInterfaceAddress: state.mdnsInterface.address,
        mdnsInterfaceName: state.mdnsInterface.name,
      },
      "mDNS 广告启动异常",
    );
    return null;
  }
}

function applyShellLanDiscoveryPublishResult(
  state: ShellLanDiscoveryState,
  started: StartAdvertiserResult | null,
  pairedPhoneIdsCount: number,
): boolean {
  if (!started) {
    return false;
  }
  if (!started.ok) {
    state.deps.onResult({ lanDiscoveryReady: false, recentServerErrorCode: started.error.code });
    state.deps.logger.warn(
      {
        code: started.error.code,
        mdnsInterfaceAddress: state.mdnsInterface.address,
        mdnsInterfaceName: state.mdnsInterface.name,
      },
      "mDNS 广告启动失败",
    );
    return false;
  }
  state.currentStop = started.stop;
  state.deps.onResult({ lanDiscoveryReady: true });
  state.deps.logger.info(
    {
      port: state.deps.protocolPort,
      mdnsInterfaceAddress: state.mdnsInterface.address,
      mdnsInterfaceName: state.mdnsInterface.name,
      pairedPhoneIdsCount,
    },
    "mDNS 广告已启动",
  );
  return true;
}

function createShellLanDiscoveryLogFields(
  state: ShellLanDiscoveryState,
  advertisement: DiscoveryAdvertisement,
): Record<string, unknown> {
  return {
    port: state.deps.protocolPort,
    mdnsInterfaceAddress: state.mdnsInterface.address,
    mdnsInterfaceName: state.mdnsInterface.name,
    advertisement,
    pairedPhoneIdsCount: advertisement.pairedPhoneIds.length,
  };
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
  onPairingChanged?: () => Promise<void> | void;
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
    await deps.onPairingChanged?.();
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
