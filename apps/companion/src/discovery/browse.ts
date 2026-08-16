/**
 * Companion / 调试用 LAN discovery 浏览客户端。
 *
 * 职责：浏览 `_lanxing-claw._tcp` 并解码 TXT 为 DiscoveryAdvertisement。
 * 不拥有：自动配对、信任建立、执行权限。
 * 副作用：经 MdnsTransport 收听组播；发现结果不得当作已认证会话。
 */

import {
  decodeDiscoveryTxt,
  LANXING_CLAW_DNS_SD_PROTOCOL,
  LANXING_CLAW_DNS_SD_TYPE,
  type DiscoveryAdvertisement,
} from "@lanxin-claw/protocol";
import type { MdnsBrowserHandle, MdnsServiceSnapshot, MdnsTransport } from "./transport/types.js";

/** 已发现的 companion 端点（未认证） */
export interface DiscoveredCompanion {
  /** DNS-SD 实例名 */
  instanceName: string;
  /** 提示端口 */
  port: number;
  /** 主机名（可空） */
  host?: string;
  /** 解码后的广告 */
  advertisement: DiscoveryAdvertisement;
}

/** 浏览回调 */
export interface DiscoveryBrowserHandlers {
  /** 发现合法广告 */
  onDiscovered: (item: DiscoveredCompanion) => void;
  /** TXT 非法或敏感键被拒绝时的可选诊断 */
  onInvalidTxt?: (service: MdnsServiceSnapshot, reason: string) => void;
  /** 服务消失 */
  onLost?: (instanceName: string) => void;
}

/**
 * 启动 discovery 浏览。
 *
 * @param transport mDNS 传输
 * @param handlers 回调
 * @returns 可停止的浏览句柄
 */
export async function startDiscoveryBrowser(
  transport: MdnsTransport,
  handlers: DiscoveryBrowserHandlers,
): Promise<MdnsBrowserHandle> {
  return transport.browse(
    LANXING_CLAW_DNS_SD_TYPE,
    LANXING_CLAW_DNS_SD_PROTOCOL,
    (service) => {
      const decoded = decodeDiscoveryTxt(service.txt);
      if (!decoded.ok) {
        handlers.onInvalidTxt?.(service, decoded.error.message);
        return;
      }
      const item: DiscoveredCompanion = {
        instanceName: service.name,
        port: service.port,
        advertisement: decoded.value,
      };
      if (service.host !== undefined) {
        item.host = service.host;
      }
      handlers.onDiscovered(item);
    },
    (service) => {
      handlers.onLost?.(service.name);
    },
  );
}
