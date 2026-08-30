/**
 * Bonjour 真实传输配置契约。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBonjourConstructorOptions } from "../../src/discovery/transport/bonjour.js";

describe("bonjour mdns transport", () => {
  it("把显式 LAN interface 传给底层 multicast-dns", () => {
    assert.deepEqual(resolveBonjourConstructorOptions({ interfaceAddress: " 192.168.1.3 " }), {
      interface: "192.168.1.3",
    });
  });

  it("没有 LAN interface 时维持 bonjour 默认参数", () => {
    assert.equal(resolveBonjourConstructorOptions(), undefined);
    assert.equal(resolveBonjourConstructorOptions({ interfaceAddress: " " }), undefined);
  });
});
