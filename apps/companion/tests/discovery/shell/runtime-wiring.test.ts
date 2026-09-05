/**
 * Electron shell 运行时接线契约。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Logger } from "pino";
import { decodeDiscoveryTxt } from "@lanxin-claw/protocol";
import { startShellLanDiscovery } from "../../../src/shell/desktop/runtime-wiring.js";
import type {
  MdnsBrowserHandle,
  MdnsPublication,
  MdnsServiceSnapshot,
  MdnsTransport,
} from "../../../src/discovery/transport/types.js";

function createSilentLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
  } as unknown as Logger;
}

function createCapturingTransport(): MdnsTransport & {
  published: MdnsServiceSnapshot[];
  stopped: MdnsServiceSnapshot[];
  destroyed: boolean;
} {
  const transport = {
    published: [] as MdnsServiceSnapshot[],
    stopped: [] as MdnsServiceSnapshot[],
    destroyed: false,
    async publish(service: MdnsServiceSnapshot): Promise<MdnsPublication> {
      const snapshot = { ...service, txt: { ...service.txt } };
      transport.published.push(snapshot);
      return {
        async stop() {
          transport.stopped.push(snapshot);
        },
      };
    },
    async browse(): Promise<MdnsBrowserHandle> {
      return {
        async stop() {
          return undefined;
        },
      };
    },
    async destroy() {
      transport.destroyed = true;
    },
  };
  return transport;
}

function readPairedPhoneIds(service: MdnsServiceSnapshot): string[] {
  const decoded = decodeDiscoveryTxt(service.txt);
  assert.equal(decoded.ok, true);
  return decoded.ok ? decoded.value.pairedPhoneIds : [];
}

describe("shell runtime wiring", () => {
  it("mDNS 广告发布 active paired phone ids，并可刷新", async () => {
    const transport = createCapturingTransport();
    let pairedPhoneIds = ["phone_a"];
    const handle = await startShellLanDiscovery({
      enabled: true,
      protocolPort: 61758,
      desktopDeviceId: "desktop_a",
      selectInterface: () => ({
        ok: true,
        candidate: { name: "Wi-Fi", address: "192.168.1.3" },
      }),
      createTransport: () => transport,
      getPairedPhoneIds: () => pairedPhoneIds,
      logger: createSilentLogger(),
      onResult: () => undefined,
    });

    assert.ok(handle);
    assert.deepEqual(readPairedPhoneIds(transport.published[0]!), ["phone_a"]);

    pairedPhoneIds = ["phone_a", "phone_b"];
    await handle.refresh();
    assert.equal(transport.stopped.length, 1);
    assert.deepEqual(readPairedPhoneIds(transport.published[1]!), ["phone_a", "phone_b"]);

    await handle.stop();
    assert.equal(transport.stopped.length, 2);
    assert.equal(transport.destroyed, true);
  });
});
