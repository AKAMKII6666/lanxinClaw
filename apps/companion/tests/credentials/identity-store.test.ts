/**
 * Companion device identity store：保存、重连 authProof、revoke。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionAuthProof } from "../../src/credentials/auth-proof.js";
import {
  createDeviceIdentityStore,
  MemoryIdentityPersistence,
} from "../../src/credentials/identity-store.js";

describe("device identity store", () => {
  it("配对完成后可保存，并用 authProof 重连", async () => {
    const store = createDeviceIdentityStore(new MemoryIdentityPersistence());
    const saved = await store.savePairedIdentity({
      pairingId: "pair_1",
      phoneDeviceId: "phone_1",
      phoneDisplayName: "Phone",
      desktopDeviceId: "desktop_1",
      desktopDisplayName: "PC",
      pairedAt: "2026-07-23T01:00:00.000Z",
    });
    assert.equal(saved.lifecycle, "active");
    assert.ok(saved.pairingSecret);

    const sessionId = "sess_1";
    const authProof = createSessionAuthProof(saved.pairingSecret!, sessionId);
    const auth = await store.authenticateReconnect({
      sessionId,
      phoneDeviceId: "phone_1",
      desktopDeviceId: "desktop_1",
      authProof,
      protocolVersion: "0.1",
    });
    assert.equal(auth.ok, true);
  });

  it("错误 authProof 要求 reopen，不得因设备 id 存在而通过", async () => {
    const store = createDeviceIdentityStore(new MemoryIdentityPersistence());
    await store.savePairedIdentity({
      pairingId: "pair_2",
      phoneDeviceId: "phone_2",
      phoneDisplayName: "Phone",
      desktopDeviceId: "desktop_2",
      desktopDisplayName: "PC",
      pairedAt: "2026-07-23T01:00:00.000Z",
    });
    const auth = await store.authenticateReconnect({
      sessionId: "sess_2",
      phoneDeviceId: "phone_2",
      desktopDeviceId: "desktop_2",
      authProof: "deadbeef",
      protocolVersion: "0.1",
    });
    assert.equal(auth.ok, false);
    if (!auth.ok) {
      assert.equal(auth.requiredAction, "reopen");
    }
  });

  it("revoke 后重连要求 repair，且幂等", async () => {
    const store = createDeviceIdentityStore(new MemoryIdentityPersistence());
    const saved = await store.savePairedIdentity({
      pairingId: "pair_3",
      phoneDeviceId: "phone_3",
      phoneDisplayName: "Phone",
      desktopDeviceId: "desktop_3",
      desktopDisplayName: "PC",
      pairedAt: "2026-07-23T01:00:00.000Z",
    });
    const pairingSecret = saved.pairingSecret!;
    const revoked = await store.revokeIdentity(
      "phone_3",
      "desktop_3",
      "user_revoke",
      "2026-07-23T02:00:00.000Z",
    );
    assert.ok(revoked);
    assert.equal(revoked!.lifecycle, "revoked");
    assert.equal(revoked!.pairingSecret, null);

    const again = await store.revokeIdentity(
      "phone_3",
      "desktop_3",
      "user_revoke_again",
      "2026-07-23T02:01:00.000Z",
    );
    assert.equal(again!.lifecycle, "revoked");
    assert.equal(again!.revokeReason, "user_revoke");

    const auth = await store.authenticateReconnect({
      sessionId: "sess_3",
      phoneDeviceId: "phone_3",
      desktopDeviceId: "desktop_3",
      authProof: createSessionAuthProof(pairingSecret, "sess_3"),
      protocolVersion: "0.1",
    });
    assert.equal(auth.ok, false);
    if (!auth.ok) {
      assert.equal(auth.requiredAction, "repair");
    }
    const active = await store.listActiveIdentities();
    assert.equal(active.length, 0);
  });

  it("未知设备对要求 repair", async () => {
    const store = createDeviceIdentityStore(new MemoryIdentityPersistence());
    const auth = await store.authenticateReconnect({
      sessionId: "sess_x",
      phoneDeviceId: "unknown",
      desktopDeviceId: "desktop_x",
      authProof: "anything",
      protocolVersion: "0.1",
    });
    assert.equal(auth.ok, false);
    if (!auth.ok) {
      assert.equal(auth.requiredAction, "repair");
    }
  });
});
