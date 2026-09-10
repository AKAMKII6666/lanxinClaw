/** LAN 发现生命周期装配；不创建 job 或改变配对授权。 */
import { PROTOCOL_VERSION, type DiscoveryAdvertisement } from "@lanxin-claw/protocol";
import type { Logger } from "pino";
import { startDiscoveryAdvertiser, type StartAdvertiserResult } from "../../../discovery/advertise.js";
import { selectLanMdnsInterface, type LanMdnsInterfaceSelection } from "../../../discovery/lan-mdns-interface.js";
import { createBonjourMdnsTransport } from "../../../discovery/transport/bonjour.js";
import type { MdnsTransport } from "../../../discovery/transport/types.js";


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
