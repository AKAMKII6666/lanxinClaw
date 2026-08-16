/**
 * Companion pairing 生命周期：双确认、拒绝跳过桌面批准、revoke。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import {
  acceptPairingRequest,
  approveDesktopPairing,
  handlePhoneConfirmed,
  revokeOrRejectPairing,
} from "../../src/pairing/lifecycle.js";

const deps = {
  desktopDeviceId: "desktop_real_001",
  desktopDisplayName: "Real PC",
  now: () => Date.parse("2026-07-23T00:00:00.000Z"),
};

function requestEnvelope(pairingId: string): ProtocolEnvelope {
  return createEnvelope({
    source: { kind: "phone", deviceId: "phone_001" },
    target: { kind: "companion", deviceId: deps.desktopDeviceId },
    type: "pairing.request",
    payload: {
      pairingId,
      phoneDeviceId: "phone_001",
      phoneDisplayName: "Phone",
      protocolVersion: "0.1",
      capabilities: ["pairing.v1"],
    },
  });
}

describe("companion pairing lifecycle", () => {
  it("完整双确认：challenge → confirmed → desktop approve → completed", () => {
    const emitted: ProtocolEnvelope[] = [];
    const emit = (e: ProtocolEnvelope) => {
      emitted.push(e);
    };
    const accepted = acceptPairingRequest(deps, requestEnvelope("pair_ok"), emit);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) {
      return;
    }
    assert.equal(accepted.session.status, "pairing_requested");
    assert.equal(emitted[0]?.type, "pairing.challenge");
    const challenge = accepted.session.challenge;
    assert.ok(challenge);

    const confirmed = handlePhoneConfirmed(
      deps,
      accepted.session,
      createEnvelope({
        source: { kind: "phone", deviceId: "phone_001" },
        target: { kind: "companion", deviceId: deps.desktopDeviceId },
        type: "pairing.confirmed",
        payload: {
          pairingId: "pair_ok",
          challengeResponse: challenge,
          phoneConfirmedAt: "2026-07-23T00:00:01.000Z",
        },
      }),
    );
    assert.equal(confirmed.ok, true);
    assert.equal(accepted.session.status, "phone_confirmed");

    // 未桌面批准前不得 completed
    assert.equal(
      emitted.some((e) => e.type === "pairing.completed"),
      false,
    );

    const approved = approveDesktopPairing(deps, accepted.session, emit);
    assert.equal(approved.ok, true);
    assert.equal(accepted.session.status, "paired");
    assert.equal(
      emitted.some((e) => e.type === "pairing.desktop_approved"),
      true,
    );
    assert.equal(
      emitted.some((e) => e.type === "pairing.completed"),
      true,
    );
  });

  it("电话未确认时桌面批准必须失败", () => {
    const emit = () => {};
    const accepted = acceptPairingRequest(deps, requestEnvelope("pair_early"), emit);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) {
      return;
    }
    const result = approveDesktopPairing(deps, accepted.session, emit);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "pairing_desktop_premature");
    }
    assert.equal(accepted.session.status, "pairing_requested");
  });

  it("错误 challenge 进入 pairing_rejected 且不 completed", () => {
    const emitted: ProtocolEnvelope[] = [];
    const accepted = acceptPairingRequest(deps, requestEnvelope("pair_bad"), (e) => {
      emitted.push(e);
    });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) {
      return;
    }
    const result = handlePhoneConfirmed(
      deps,
      accepted.session,
      createEnvelope({
        source: { kind: "phone", deviceId: "phone_001" },
        target: { kind: "companion", deviceId: deps.desktopDeviceId },
        type: "pairing.confirmed",
        payload: {
          pairingId: "pair_bad",
          challengeResponse: "wrong",
          phoneConfirmedAt: "2026-07-23T00:00:01.000Z",
        },
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(accepted.session.status, "pairing_rejected");
    assert.equal(
      emitted.some((e) => e.type === "pairing.completed"),
      false,
    );
  });

  it("paired 后 revoke 发出 pairing.revoked", () => {
    const emitted: ProtocolEnvelope[] = [];
    const emit = (e: ProtocolEnvelope) => {
      emitted.push(e);
    };
    const accepted = acceptPairingRequest(deps, requestEnvelope("pair_rev"), emit);
    assert.ok(accepted.ok);
    if (!accepted.ok) {
      return;
    }
    const challenge = accepted.session.challenge!;
    assert.equal(
      handlePhoneConfirmed(
        deps,
        accepted.session,
        createEnvelope({
          source: { kind: "phone", deviceId: "phone_001" },
          target: { kind: "companion", deviceId: deps.desktopDeviceId },
          type: "pairing.confirmed",
          payload: {
            pairingId: "pair_rev",
            challengeResponse: challenge,
            phoneConfirmedAt: "2026-07-23T00:00:01.000Z",
          },
        }),
      ).ok,
      true,
    );
    assert.equal(approveDesktopPairing(deps, accepted.session, emit).ok, true);
    assert.equal(accepted.session.status, "paired");

    const revoked = revokeOrRejectPairing(deps, accepted.session, "user_revoke", emit);
    assert.equal(revoked.ok, true);
    assert.equal(accepted.session.status, "revoked");
    assert.equal(
      emitted.some((e) => e.type === "pairing.revoked"),
      true,
    );
  });
});
