/** 认证与会话生命周期；从原合同测试按职责拆出，用例与断言保持完整。 */
import {
PROTOCOL_VERSION,
createEnvelope,
} from "@lanxin-claw/protocol";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import WebSocket from "ws";
import { createSessionAuthProof } from "../../../src/credentials/auth-proof.js";
import {
createJsonReader,
openSession,
startHarness,
waitFor,
} from "../harness.js";
import { createCaptureLogger } from "../support/capture-logger.js";

describe("companion protocol server · 认证与会话生命周期", () => {

  it("session.open 入站日志落 redacted DTO", { timeout: 5000 }, async () => {
    const captured = createCaptureLogger();
    const { server, socket, identityStore } = await startHarness({ logger: captured.logger });
    const reader = createJsonReader(socket);
    try {
      const identity = await identityStore.savePairedIdentity({
        pairingId: "pair_log_001",
        phoneDeviceId: "phone_log_001",
        phoneDisplayName: "phone",
        desktopDeviceId: "desktop_srv_001",
        desktopDisplayName: "desktop",
        pairedAt: new Date().toISOString(),
      });
      const sessionId = "sess_log_001";
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_log_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "session.open",
        payload: {
          sessionId,
          phoneDeviceId: "phone_log_001",
          desktopDeviceId: "desktop_srv_001",
          authProof: createSessionAuthProof(identity.pairingSecret ?? "", sessionId),
          protocolVersion: PROTOCOL_VERSION,
        },
      })));
      await reader.nextEnvelope("session.accepted");
      await waitFor(() =>
        captured.entries.some((entry) => {
          const meta = entry.meta as {
            event?: string;
            dto?: { type?: string; payload?: { authProof?: string } };
          };
          return meta.event === "protocol.inbound.dto" && meta.dto?.type === "session.open";
        }),
      );
      const inbound = captured.entries.find((entry) => {
        const meta = entry.meta as {
          event?: string;
          dto?: { type?: string; payload?: { authProof?: string } };
        };
        return meta.event === "protocol.inbound.dto" && meta.dto?.type === "session.open";
      });
      const dto = inbound?.meta.dto as { payload?: { authProof?: string } } | undefined;
      assert.equal(dto?.payload?.authProof, "[redacted]");
    } finally {
      socket.close();
      await server.close();
    }
  });


  it("心跳超时标记失联、广播 session.closed、业务被拒、重连恢复", { timeout: 8000 }, async () => {
    const { server, socket, backend, identityStore } = await startHarness({
      heartbeatIntervalMs: 50,
      missedHeartbeats: 2,
    });
    const reader = createJsonReader(socket);
    try {
      backend.getState().connection.sessionAuthenticated = true;
      backend.getState().connection.sessionId = "sess_hb_001";
      backend.getState().connection.phoneDeviceId = "phone_hb_001";
      backend.getState().connection.lastSeenAt = new Date(Date.now() - 5_000).toISOString();

      await waitFor(() => !backend.getState().connection.sessionAuthenticated);
      assert.equal(backend.getState().lastError?.code, "connection_lost");
      const closed = await reader.nextEnvelope("session.closed");
      assert.equal((closed.payload as { reason?: string }).reason, "heartbeat_timeout");

      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_hb_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_hb_001",
          title: "心跳超时后业务",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: [],
          acceptanceCriteria: [],
          blockedReason: null,
          resumeCondition: null,
          currentJobId: null,
        },
      })));
      const rejected = await reader.next("session required");
      assert.equal(rejected.error.code, "session_required");

      await identityStore.savePairedIdentity({
        pairingId: "pair_hb_001",
        phoneDeviceId: "phone_hb_001",
        phoneDisplayName: "heartbeat phone",
        desktopDeviceId: "desktop_srv_001",
        desktopDisplayName: "desktop",
        pairedAt: new Date().toISOString(),
      });
      const identity = await identityStore.findIdentity("phone_hb_001", "desktop_srv_001");
      assert.ok(identity?.pairingSecret);
      const sessionId = "sess_hb_002";
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_hb_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "session.open",
        payload: {
          sessionId,
          phoneDeviceId: "phone_hb_001",
          desktopDeviceId: "desktop_srv_001",
          authProof: createSessionAuthProof(identity.pairingSecret ?? "", sessionId),
          protocolVersion: PROTOCOL_VERSION,
        },
      })));
      assert.equal((await reader.nextEnvelope("session.accepted")).type, "session.accepted");
      assert.equal(backend.getState().connection.sessionAuthenticated, true);
    } finally {
      socket.close();
      await server.close();
    }
  });


  it("认证 socket 关闭后立即标记 session 失联", { timeout: 5000 }, async () => {
    const { server, socket, backend, identityStore } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      await openSession(socket, reader, identityStore);
      assert.equal(backend.getState().connection.sessionAuthenticated, true);

      socket.close();
      await waitFor(() => !backend.getState().connection.sessionAuthenticated);

      assert.equal(backend.getState().lastError?.code, "connection_lost");
    } finally {
      await server.close();
    }
  });


  it("未 session 时业务消息被拒且不写状态", { timeout: 5000 }, async () => {
    const { server, socket, backend } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_no_session_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_no_session_001",
          title: "未认证业务",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: [],
          acceptanceCriteria: [],
          blockedReason: null,
          resumeCondition: null,
          currentJobId: null,
        },
      })));
      const msg = await reader.next("session required");
      assert.equal(msg.ok, false);
      assert.equal(msg.error.code, "session_required");
      assert.equal(backend.getState().affairs.has("affair_no_session_001"), false);
    } finally {
      socket.close();
      await server.close();
    }
  });


  it("拒绝非法 envelope", { timeout: 5000 }, async () => {
    const { server, socket } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      socket.send(JSON.stringify({ type: "unknown" }));
      const msg = await reader.next("invalid envelope");
      assert.equal(msg.ok, false);
    } finally {
      socket.close();
      await server.close();
    }
  });
});
