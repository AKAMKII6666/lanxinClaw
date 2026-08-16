/**
 * Bridge + pairing reconnect/revoke 联合契约：UI 操作与身份边界。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import { CompanionBridgeHost } from "../../src/bridge/host.js";
import { createSessionAuthProof } from "../../src/credentials/auth-proof.js";
import {
  createDeviceIdentityStore,
  MemoryIdentityPersistence,
} from "../../src/credentials/identity-store.js";
import {
  acceptPairingRequest,
  approveDesktopPairing,
  handlePhoneConfirmed,
  revokeOrRejectPairing,
} from "../../src/pairing/lifecycle.js";

const deps = {
  desktopDeviceId: "desktop_contract_001",
  desktopDisplayName: "Contract PC",
  now: () => Date.parse("2026-07-23T04:00:00.000Z"),
};

/**
 * @param pairingId pairing id
 * @returns pairing.request envelope
 */
function requestEnvelope(pairingId: string): ProtocolEnvelope {
  return createEnvelope({
    source: { kind: "phone", deviceId: "phone_contract_001" },
    target: { kind: "companion", deviceId: deps.desktopDeviceId },
    type: "pairing.request",
    payload: {
      pairingId,
      phoneDeviceId: "phone_contract_001",
      phoneDisplayName: "Contract Phone",
      protocolVersion: "0.1",
      capabilities: ["pairing.v1"],
    },
  });
}

describe("bridge × pairing reconnect/revoke contract", () => {
  it("双确认完成后 identity 可重连；bridge revoke 仍走白名单", async () => {
    const emitted: ProtocolEnvelope[] = [];
    const emit = (e: ProtocolEnvelope) => {
      emitted.push(e);
    };
    const accepted = acceptPairingRequest(deps, requestEnvelope("pair_contract_1"), emit);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) {
      return;
    }
    const challenge = accepted.session.challenge!;
    assert.equal(
      handlePhoneConfirmed(
        deps,
        accepted.session,
        createEnvelope({
          source: { kind: "phone", deviceId: "phone_contract_001" },
          target: { kind: "companion", deviceId: deps.desktopDeviceId },
          type: "pairing.confirmed",
          payload: {
            pairingId: "pair_contract_1",
            challengeResponse: challenge,
            phoneConfirmedAt: "2026-07-23T04:00:01.000Z",
          },
        }),
      ).ok,
      true,
    );
    assert.equal(approveDesktopPairing(deps, accepted.session, emit).ok, true);
    assert.equal(accepted.session.status, "paired");

    const store = createDeviceIdentityStore(new MemoryIdentityPersistence());
    const saved = await store.savePairedIdentity({
      pairingId: "pair_contract_1",
      phoneDeviceId: "phone_contract_001",
      phoneDisplayName: "Contract Phone",
      desktopDeviceId: deps.desktopDeviceId,
      desktopDisplayName: deps.desktopDisplayName,
      pairedAt: "2026-07-23T04:00:02.000Z",
    });
    const sessionId = "sess_contract_1";
    const authProof = createSessionAuthProof(saved.pairingSecret!, sessionId);
    const auth = await store.authenticateReconnect({
      sessionId,
      phoneDeviceId: "phone_contract_001",
      desktopDeviceId: deps.desktopDeviceId,
      authProof,
      protocolVersion: "0.1",
    });
    assert.equal(auth.ok, true);

    const host = new CompanionBridgeHost();
    const revokeAction = host.submitAction({
      type: "device.revokePairing",
      phoneDeviceId: "phone_contract_001",
      desktopDeviceId: deps.desktopDeviceId,
    });
    assert.equal(revokeAction.ok, true);

    const revoked = await store.revokeIdentity(
      "phone_contract_001",
      deps.desktopDeviceId,
      "user_revoke",
      "2026-07-23T04:05:00.000Z",
    );
    assert.ok(revoked);
    assert.equal(revoked!.lifecycle, "revoked");

    const afterRevoke = await store.authenticateReconnect({
      sessionId: "sess_contract_2",
      phoneDeviceId: "phone_contract_001",
      desktopDeviceId: deps.desktopDeviceId,
      authProof: createSessionAuthProof(saved.pairingSecret!, "sess_contract_2"),
      protocolVersion: "0.1",
    });
    assert.equal(afterRevoke.ok, false);
    if (!afterRevoke.ok) {
      assert.equal(afterRevoke.requiredAction, "repair");
    }

    const lifeRevoked = revokeOrRejectPairing(deps, accepted.session, "user_revoke", emit);
    assert.equal(lifeRevoked.ok, true);
    assert.equal(accepted.session.status, "revoked");
    assert.equal(
      emitted.some((e) => e.type === "pairing.revoked"),
      true,
    );
  });

  it("bridge 拒绝非白名单危险 action（不得绕过 companion）", () => {
    const host = new CompanionBridgeHost();
    assert.equal(
      host.submitAction({ type: "shell.exec", command: "git status" } as never).ok,
      false,
    );
    assert.equal(
      host.submitAction({ type: "fs.readFile", path: "package.json" } as never).ok,
      false,
    );
  });
});
