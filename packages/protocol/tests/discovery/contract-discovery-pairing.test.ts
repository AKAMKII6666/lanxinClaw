/**
 * Discovery 广告与 pairing 状态机 contract。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canTransitionPairingStatus,
  decodeDiscoveryTxt,
  encodeDiscoveryTxt,
  validateDiscoveryAdvertisement,
  type DiscoveryAdvertisement,
} from "../../src/index.js";

const sampleAd: DiscoveryAdvertisement = {
  deviceName: "LIAO-PC",
  deviceIdHint: "desktop_fingerprint_hint",
  serviceVersion: "0.1.0",
  protocolVersion: "0.2",
  pairingAvailable: true,
  pairedPhoneIds: [],
  capabilities: ["pairing.v1", "session.v1"],
};

describe("discovery advertisement contract", () => {
  it("正例：编解码往返保持字段", () => {
    const txt = encodeDiscoveryTxt(sampleAd);
    const decoded = decodeDiscoveryTxt(txt);
    assert.equal(decoded.ok, true);
    if (decoded.ok) {
      assert.deepEqual(decoded.value, sampleAd);
    }
  });

  it("反例：TXT 含 apiKey 等敏感键必须拒绝", () => {
    const txt = { ...encodeDiscoveryTxt(sampleAd), apiKey: "sk-leak" };
    const result = decodeDiscoveryTxt(txt);
    assert.equal(result.ok, false);
  });

  it("反例：advertisement 对象含 filepath 字段必须拒绝", () => {
    const result = validateDiscoveryAdvertisement({
      ...sampleAd,
      filepath: "C:\\\\secrets",
    });
    assert.equal(result.ok, false);
  });

  it("正例：validateDiscoveryAdvertisement 接受合法对象", () => {
    const result = validateDiscoveryAdvertisement(sampleAd);
    assert.equal(result.ok, true);
  });
});

describe("pairing 状态机 contract", () => {
  it("happy path：unpaired → … → paired", () => {
    assert.equal(canTransitionPairingStatus("unpaired", "pairing_requested"), true);
    assert.equal(canTransitionPairingStatus("pairing_requested", "phone_confirmed"), true);
    assert.equal(canTransitionPairingStatus("phone_confirmed", "desktop_confirmed"), true);
    assert.equal(canTransitionPairingStatus("desktop_confirmed", "paired"), true);
  });

  it("拒绝跳过桌面确认直接 paired", () => {
    assert.equal(canTransitionPairingStatus("phone_confirmed", "paired"), false);
    assert.equal(canTransitionPairingStatus("pairing_requested", "paired"), false);
  });

  it("paired 可 revoked；revoked 为终态", () => {
    assert.equal(canTransitionPairingStatus("paired", "revoked"), true);
    assert.equal(canTransitionPairingStatus("revoked", "paired"), false);
    assert.equal(canTransitionPairingStatus("pairing_rejected", "pairing_requested"), false);
  });
});
