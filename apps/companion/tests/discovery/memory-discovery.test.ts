/**
 * Companion discovery（内存 mDNS）contract。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startDiscoveryAdvertiser } from "../../src/discovery/advertise.js";
import { startDiscoveryBrowser } from "../../src/discovery/browse.js";
import { createMemoryMdnsTransport } from "../../src/discovery/transport/memory.js";
import type { DiscoveryAdvertisement } from "@lanxin-claw/protocol";

const ad: DiscoveryAdvertisement = {
  deviceName: "Test-PC",
  deviceIdHint: "hint_001",
  serviceVersion: "0.1.0",
  protocolVersion: "0.1",
  pairingAvailable: true,
  pairedPhoneIds: [],
  capabilities: ["pairing.v1"],
};

describe("companion discovery memory transport", () => {
  it("advertise 后 browse 能解码到同一广告且不授予信任", async () => {
    const transport = createMemoryMdnsTransport();
    const found: string[] = [];
    const browser = await startDiscoveryBrowser(transport, {
      onDiscovered: (item) => {
        found.push(item.advertisement.deviceIdHint);
        assert.equal(item.port, 17890);
        assert.equal(item.advertisement.pairingAvailable, true);
      },
    });
    const started = await startDiscoveryAdvertiser(transport, {
      instanceName: "Test-PC",
      port: 17890,
      advertisement: ad,
    });
    assert.equal(started.ok, true);
    assert.deepEqual(found, ["hint_001"]);
    if (started.ok) {
      await started.stop();
    }
    await browser.stop();
    await transport.destroy();
  });

  it("拒绝含敏感字段的广告，不发布", async () => {
    const transport = createMemoryMdnsTransport();
    const started = await startDiscoveryAdvertiser(transport, {
      instanceName: "Bad",
      port: 1,
      advertisement: { ...ad, apiKey: "sk" } as DiscoveryAdvertisement,
    });
    assert.equal(started.ok, false);
    await transport.destroy();
  });
});
