/**
 * 入站方向与认证守卫单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import { validateInboundAuth, validateInboundIdentity } from "../../../src/protocol-server/guards/inbound/inbound-auth.js";
import { validateInboundFromPhone } from "../../../src/protocol-server/guards/inbound/message-direction.js";

describe("inbound guards", () => {
  it("拒绝 phone 伪造 companion→phone 类型", () => {
    const result = validateInboundFromPhone(
      createEnvelope({
        source: { kind: "phone", deviceId: "phone_001" },
        target: { kind: "companion", deviceId: "desktop_001" },
        type: "job.completed",
        payload: {
          jobId: "job_x",
          affairId: "affair_x",
          executor: "openclaw",
          status: "completed",
          goal: "fake",
          allowedPermissions: ["workspace.read"],
        },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "inbound_direction_rejected");
    }
  });

  it("未认证 socket 拒绝 session.heartbeat", () => {
    const result = validateInboundAuth("session.heartbeat", false);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "session_required");
    }
  });

  it("phone→companion 须 source=phone target=companion", () => {
    const result = validateInboundFromPhone(
      createEnvelope({
        source: { kind: "companion", deviceId: "desktop_001" },
        target: { kind: "phone", deviceId: "phone_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_x",
          title: "x",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: [],
          acceptanceCriteria: [],
        },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "inbound_direction_invalid");
    }
  });

  it("pairing.revoked 不得由 phone 入站", () => {
    const result = validateInboundFromPhone(
      createEnvelope({
        source: { kind: "phone", deviceId: "phone_001" },
        target: { kind: "companion", deviceId: "desktop_001" },
        type: "pairing.revoked",
        payload: {
          pairingId: "pair_x",
          phoneDeviceId: "phone_001",
          desktopDeviceId: "desktop_001",
          reason: "fake",
          revokedAt: new Date().toISOString(),
        },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "inbound_direction_rejected");
    }
  });

  it("入站 identity 须匹配 connection 与 desktopDeviceId", () => {
    const mismatch = validateInboundIdentity(
      createEnvelope({
        source: { kind: "phone", deviceId: "phone_wrong" },
        target: { kind: "companion", deviceId: "desktop_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_x",
          title: "x",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: [],
          acceptanceCriteria: [],
        },
      }),
      {
        phoneDeviceId: "phone_001",
        phoneDisplayName: null,
        pairingId: "pair_x",
        sessionId: "sess_x",
        lastSeenAt: null,
        sessionAuthenticated: true,
      },
      "desktop_001",
    );
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.equal(mismatch.code, "inbound_identity_mismatch");
    }
  });
});
