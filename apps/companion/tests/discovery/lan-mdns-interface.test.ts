/**
 * LAN mDNS 网卡选择契约。
 */

import assert from "node:assert/strict";
import type os from "node:os";
import { describe, it } from "node:test";
import {
  listLanMdnsInterfaceCandidates,
  selectLanMdnsInterface,
} from "../../src/discovery/lan-mdns-interface.js";

function ipv4(address: string, internal = false): os.NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  };
}

describe("LAN mDNS interface selection", () => {
  it("多网卡时选择真实 LAN IPv4", () => {
    const selected = selectLanMdnsInterface({
      Clash: [ipv4("198.18.0.1")],
      "vEthernet (WSL)": [ipv4("172.30.16.1")],
      "vEthernet (Default Switch)": [ipv4("172.28.112.1")],
      "Loopback Pseudo-Interface 1": [ipv4("127.0.0.1", true)],
      "以太网 4": [ipv4("192.168.1.3")],
    });

    assert.equal(selected.ok, true);
    if (selected.ok) {
      assert.deepEqual(selected.candidate, {
        name: "以太网 4",
        address: "192.168.1.3",
      });
    }
  });

  it("只公开非 internal IPv4 候选", () => {
    assert.deepEqual(
      listLanMdnsInterfaceCandidates({
        lo: [ipv4("127.0.0.1", true)],
        eth0: [ipv4("192.168.1.3")],
      }),
      [{ name: "eth0", address: "192.168.1.3" }],
    );
  });

  it("显式 interface 地址存在时优先使用", () => {
    const selected = selectLanMdnsInterface(
      {
        "以太网 4": [ipv4("192.168.1.3")],
        wlan0: [ipv4("10.0.0.8")],
      },
      { explicitAddress: "10.0.0.8" },
    );

    assert.equal(selected.ok, true);
    if (selected.ok) {
      assert.deepEqual(selected.candidate, { name: "wlan0", address: "10.0.0.8" });
    }
  });

  it("显式 interface 地址不可用时不回退到猜测", () => {
    const selected = selectLanMdnsInterface(
      {
        "以太网 4": [ipv4("192.168.1.3")],
        "vEthernet (WSL)": [ipv4("172.30.16.1")],
      },
      { explicitAddress: "172.30.16.1" },
    );

    assert.deepEqual(selected, { ok: false, code: "mdns_interface_unavailable" });
  });

  it("没有可用 LAN IPv4 时返回不可发布", () => {
    const selected = selectLanMdnsInterface({
      Clash: [ipv4("198.18.0.1")],
      "vEthernet (WSL)": [ipv4("172.30.16.1")],
      lo: [ipv4("127.0.0.1", true)],
    });

    assert.deepEqual(selected, { ok: false, code: "mdns_interface_unavailable" });
  });

  it("不会因为真实网卡名包含 tun/tap 子串而误判为虚拟网卡", () => {
    const selected = selectLanMdnsInterface({
      "Saturn Ethernet": [ipv4("192.168.1.3")],
    });

    assert.equal(selected.ok, true);
    if (selected.ok) {
      assert.deepEqual(selected.candidate, {
        name: "Saturn Ethernet",
        address: "192.168.1.3",
      });
    }
  });
});
