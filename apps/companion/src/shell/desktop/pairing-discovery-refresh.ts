/**
 * pairing 变化后的 LAN discovery 刷新辅助。
 *
 * 职责：从 identity store 读取 active phone id，并触发 mDNS 广告刷新。
 * 不拥有：mDNS 发布、pairing 状态机、Electron 生命周期。
 */

import type { DeviceIdentityStore } from "../../credentials/identity-store.js";
import type { ShellLanDiscoveryHandle } from "./runtime-wiring.js";
import type { Logger } from "pino";

export function createActivePairedPhoneIdsReader(deps: {
  identityStore: DeviceIdentityStore;
  desktopDeviceId: string;
}): () => Promise<string[]> {
  return async () => {
    const identities = await deps.identityStore.listActiveIdentities();
    return identities
      .filter((identity) => identity.desktopDeviceId === deps.desktopDeviceId)
      .map((identity) => identity.phoneDeviceId);
  };
}

export function createLanDiscoveryPairingRefresher(deps: {
  getHandle: () => ShellLanDiscoveryHandle | null;
  logger: Logger;
}): () => Promise<void> {
  return async () => {
    const handle = deps.getHandle();
    if (!handle) {
      return;
    }
    try {
      await handle.refresh();
    } catch (error) {
      deps.logger.warn(
        {
          code: "mdns_advertise_refresh_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        "mDNS 广告刷新失败",
      );
    }
  };
}
