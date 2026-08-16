/**
 * 首次 Pairing 视图与指纹截断单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoPendingPairingRequest } from "../../src/pairing/views/demo-pending-request.js";
import { formatFingerprintHint } from "../../src/pairing/views/format-fingerprint-hint.js";

describe("pairing dialog views", () => {
  it("formatFingerprintHint 截断且不回传原文长串", () => {
    assert.equal(formatFingerprintHint("8F2A9C01DEADBEEF"), "8F:2A:…");
    assert.equal(formatFingerprintHint("ab"), "未知指纹");
  });

  it("演示请求含指纹、双确认文案且无 pairingSecret", () => {
    const request = createDemoPendingPairingRequest();
    assert.equal(request.fingerprintHint, "8F:2A:…");
    assert.ok(request.dualConfirmHint.includes("电话端确认"));
    assert.ok(request.summary.includes("不会传输凭据"));
    assert.equal(JSON.stringify(request).includes("pairingSecret"), false);
  });
});
