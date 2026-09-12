/**
 * pairing.confirmed 负向与正向契约：错误应答 / 过期不得建 session。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import { loadMockCompanionConfig } from "../../src/config.js";
import {
  handlePairingConfirmed,
  handlePairingRequest,
  handleSessionOpen,
} from "../../src/pairing/handle-pairing.js";
import { createMemoryStore } from "../../src/store/memory-store.js";

function confirmedEnvelope(
  pairingId: string,
  challengeResponse: string,
): ProtocolEnvelope {
  return createEnvelope({
    source: { kind: "phone", deviceId: "phone_test_001" },
    target: { kind: "companion", deviceId: "desktop_mock_001" },
    type: "pairing.confirmed",
    payload: {
      pairingId,
      challengeResponse,
      phoneConfirmedAt: new Date().toISOString(),
    },
  });
}

describe("handlePairingConfirmed", () => {
  it("错误 challengeResponse 应失败且不写入 paired", () => {
    const config = loadMockCompanionConfig({
      MOCK_COMPANION_DEVICE_ID: "desktop_mock_001",
    });
    const store = createMemoryStore(Date.now());
    const emitted: ProtocolEnvelope[] = [];
    const emit = (e: ProtocolEnvelope) => {
      emitted.push(e);
    };

    const request = createEnvelope({
      source: { kind: "phone", deviceId: "phone_test_001" },
      target: { kind: "companion", deviceId: config.desktopDeviceId },
      type: "pairing.request",
      payload: {
        pairingId: "pair_test_wrong",
        phoneDeviceId: "phone_test_001",
        phoneDisplayName: "Test Phone",
        protocolVersion: "0.2",
        capabilities: [],
      },
    });
    assert.equal(handlePairingRequest(store, config, request, emit).ok, true);

    const result = handlePairingConfirmed(
      store,
      config,
      confirmedEnvelope("pair_test_wrong", "wrong-response"),
      emit,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "pairing_challenge_mismatch");
    }
    assert.equal(store.paired, null);
    assert.equal(store.pendingChallenge, null);
    assert.equal(
      emitted.some((e) => e.type === "pairing.completed"),
      false,
    );

    const sessionResult = handleSessionOpen(
      store,
      config,
      createEnvelope({
        source: { kind: "phone", deviceId: "phone_test_001" },
        target: { kind: "companion", deviceId: config.desktopDeviceId },
        type: "session.open",
        payload: {
          sessionId: "sess_after_fail",
          phoneDeviceId: "phone_test_001",
          desktopDeviceId: config.desktopDeviceId,
          authProof: "mock-paired:pair_test_wrong",
        },
      }),
      emit,
    );
    assert.equal(sessionResult.ok, false);
  });

  it("过期 challenge 应失败并清理 pending", () => {
    const config = loadMockCompanionConfig({
      MOCK_COMPANION_DEVICE_ID: "desktop_mock_001",
    });
    const store = createMemoryStore(Date.now());
    const emit = () => {};
    store.pendingChallenge = {
      pairingId: "pair_expired",
      challenge: "mock-challenge-pair_expired",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      phoneDeviceId: "phone_test_001",
      phoneDisplayName: "Test Phone",
    };

    const result = handlePairingConfirmed(
      store,
      config,
      confirmedEnvelope("pair_expired", "mock-challenge-pair_expired"),
      emit,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "pairing_challenge_expired");
    }
    assert.equal(store.paired, null);
    assert.equal(store.pendingChallenge, null);
  });

  it("正确应答仍可完成配对", () => {
    const config = loadMockCompanionConfig({
      MOCK_COMPANION_DEVICE_ID: "desktop_mock_001",
    });
    const store = createMemoryStore(Date.now());
    const emitted: ProtocolEnvelope[] = [];
    const emit = (e: ProtocolEnvelope) => {
      emitted.push(e);
    };

    const pairingId = "pair_ok";
    const request = createEnvelope({
      source: { kind: "phone", deviceId: "phone_test_001" },
      target: { kind: "companion", deviceId: config.desktopDeviceId },
      type: "pairing.request",
      payload: {
        pairingId,
        phoneDeviceId: "phone_test_001",
        phoneDisplayName: "Test Phone",
        protocolVersion: "0.2",
        capabilities: [],
      },
    });
    assert.equal(handlePairingRequest(store, config, request, emit).ok, true);
    const challenge = store.pendingChallenge?.challenge;
    assert.ok(challenge);

    const result = handlePairingConfirmed(
      store,
      config,
      confirmedEnvelope(pairingId, challenge),
      emit,
    );
    assert.equal(result.ok, true);
    assert.ok(store.paired);
    assert.equal(store.paired?.pairingId, pairingId);
    assert.equal(
      emitted.some((e) => e.type === "pairing.completed"),
      true,
    );
  });
});
