/**
 * 进程内 mDNS 假传输（单测 / 无组播环境）。
 *
 * 职责：在同一 transport 实例内联通 publish 与 browse。
 * 不拥有：真实局域网发现、配对、凭据。
 * 副作用：仅更新本实例内存表；Discovery ≠ trust。
 */

import type {
  MdnsBrowserHandle,
  MdnsPublication,
  MdnsServiceSnapshot,
  MdnsTransport,
} from "./types.js";

interface BrowserEntry {
  type: string;
  protocol: string;
  onUp: (service: MdnsServiceSnapshot) => void;
  onDown?: (service: MdnsServiceSnapshot) => void;
}

/**
 * 创建内存 mDNS 传输。
 *
 * @returns 可注入 advertiser / browser 的传输
 */
export function createMemoryMdnsTransport(): MdnsTransport {
  const published = new Map<string, MdnsServiceSnapshot>();
  const browsers = new Set<BrowserEntry>();

  const keyOf = (s: MdnsServiceSnapshot): string =>
    `${s.protocol}|${s.type}|${s.name}|${s.port}`;

  return {
    async publish(service: MdnsServiceSnapshot): Promise<MdnsPublication> {
      const key = keyOf(service);
      published.set(key, service);
      for (const browser of browsers) {
        if (browser.type === service.type && browser.protocol === service.protocol) {
          browser.onUp({ ...service, txt: { ...service.txt } });
        }
      }
      return {
        async stop() {
          published.delete(key);
          for (const browser of browsers) {
            if (browser.type === service.type && browser.protocol === service.protocol) {
              browser.onDown?.({ ...service, txt: { ...service.txt } });
            }
          }
        },
      };
    },

    async browse(
      type: string,
      protocol: string,
      onUp: (service: MdnsServiceSnapshot) => void,
      onDown?: (service: MdnsServiceSnapshot) => void,
    ): Promise<MdnsBrowserHandle> {
      const entry: BrowserEntry = { type, protocol, onUp };
      if (onDown) {
        entry.onDown = onDown;
      }
      browsers.add(entry);
      for (const service of published.values()) {
        if (service.type === type && service.protocol === protocol) {
          onUp({ ...service, txt: { ...service.txt } });
        }
      }
      return {
        async stop() {
          browsers.delete(entry);
        },
      };
    },

    async destroy() {
      published.clear();
      browsers.clear();
    },
  };
}
