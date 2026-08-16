/**
 * Companion LAN discovery 广告器。
 *
 * 职责：把合法 DiscoveryAdvertisement 发布为 `_lanxing-claw._tcp` 服务。
 * 不拥有：配对、session、权限、凭据存储。
 * 副作用：经注入的 MdnsTransport 发布组播广告；Discovery ≠ trust。
 */

import {
  encodeDiscoveryTxt,
  LANXING_CLAW_DNS_SD_PROTOCOL,
  LANXING_CLAW_DNS_SD_TYPE,
  validateDiscoveryAdvertisement,
  type DiscoveryAdvertisement,
  type ProtocolError,
} from "@lanxin-claw/protocol";
import type { MdnsPublication, MdnsTransport } from "./transport/types.js";

/** 广告器配置 */
export interface DiscoveryAdvertiserConfig {
  /** DNS-SD 实例名（通常等于 deviceName） */
  instanceName: string;
  /** companion 桥接端口；发现阶段仅作连接提示 */
  port: number;
  /** 广告载荷 */
  advertisement: DiscoveryAdvertisement;
}

/** 启动结果 */
export type StartAdvertiserResult =
  | { ok: true; stop: () => Promise<void> }
  | { ok: false; error: ProtocolError };

/**
 * 启动 LAN discovery 广告。
 *
 * @param transport mDNS 传输
 * @param config 广告配置
 * @returns 成功时带 stop；校验失败不发布
 */
export async function startDiscoveryAdvertiser(
  transport: MdnsTransport,
  config: DiscoveryAdvertiserConfig,
): Promise<StartAdvertiserResult> {
  const validated = validateDiscoveryAdvertisement(config.advertisement);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const publication: MdnsPublication = await transport.publish({
    name: config.instanceName,
    type: LANXING_CLAW_DNS_SD_TYPE,
    protocol: LANXING_CLAW_DNS_SD_PROTOCOL,
    port: config.port,
    txt: encodeDiscoveryTxt(validated.value),
  });

  return {
    ok: true,
    stop: async () => {
      await publication.stop();
    },
  };
}
