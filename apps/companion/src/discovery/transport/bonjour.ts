/**
 * 基于 bonjour-service 的真实 mDNS 传输。
 *
 * 职责：把 companion 广告/浏览接到本机 DNS-SD。
 * 不拥有：TXT 语义校验、配对、权限。
 * 副作用：打开组播 UDP；destroy 时释放。
 */

import Bonjour from "bonjour-service";
import type {
  MdnsBrowserHandle,
  MdnsPublication,
  MdnsServiceSnapshot,
  MdnsTransport,
} from "./types.js";

/** bonjour 回调里用到的最小服务形状 */
interface BonjourServiceLike {
  name: string;
  type: string;
  protocol: string;
  port: number;
  host?: string;
  txt?: Record<string, unknown>;
}

/** bonjour browser 最小形状 */
interface BonjourBrowserLike {
  on: (event: "up" | "down", cb: (service: BonjourServiceLike) => void) => void;
  stop: () => void;
}

/** bonjour 已发布服务最小形状 */
interface BonjourPublishedLike {
  stop: (cb?: () => void) => void;
}

/**
 * 将 bonjour 服务规范为快照。
 *
 * @param service bonjour 服务对象
 * @returns 快照
 */
function toSnapshot(service: BonjourServiceLike): MdnsServiceSnapshot {
  const txt: Record<string, string> = {};
  const raw = service.txt ?? {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      txt[k] = v;
    } else if (v != null) {
      txt[k] = String(v);
    }
  }
  const snapshot: MdnsServiceSnapshot = {
    name: service.name,
    type: service.type,
    protocol: service.protocol,
    port: service.port,
    txt,
  };
  if (service.host !== undefined) {
    snapshot.host = service.host;
  }
  return snapshot;
}

/**
 * 创建 Bonjour mDNS 传输。
 *
 * @returns 真实组播传输
 */
export function createBonjourMdnsTransport(): MdnsTransport {
  const bonjour = new Bonjour();
  const browsers: BonjourBrowserLike[] = [];

  return {
    async publish(service: MdnsServiceSnapshot): Promise<MdnsPublication> {
      const published = bonjour.publish({
        name: service.name,
        type: service.type,
        protocol: service.protocol as "tcp" | "udp",
        port: service.port,
        txt: service.txt,
      }) as unknown as BonjourPublishedLike;
      return {
        async stop() {
          await new Promise<void>((resolve) => {
            published.stop(() => resolve());
          });
        },
      };
    },

    async browse(
      type: string,
      protocol: string,
      onUp: (service: MdnsServiceSnapshot) => void,
      onDown?: (service: MdnsServiceSnapshot) => void,
    ): Promise<MdnsBrowserHandle> {
      const browser = bonjour.find({
        type,
        protocol: protocol as "tcp" | "udp",
      }) as BonjourBrowserLike;
      browsers.push(browser);
      browser.on("up", (service) => {
        onUp(toSnapshot(service));
      });
      if (onDown) {
        browser.on("down", (service) => {
          onDown(toSnapshot(service));
        });
      }
      return {
        async stop() {
          browser.stop();
          const idx = browsers.indexOf(browser);
          if (idx >= 0) {
            browsers.splice(idx, 1);
          }
        },
      };
    },

    async destroy() {
      for (const browser of browsers.splice(0, browsers.length)) {
        browser.stop();
      }
      await new Promise<void>((resolve) => {
        bonjour.destroy(() => resolve());
      });
    },
  };
}
