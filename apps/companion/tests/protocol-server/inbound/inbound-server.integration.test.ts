/**
 * 入站守卫 server 集成测试。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import {
  createJsonReader,
  openSession,
  startHarness,
} from "../harness.js";

describe("protocol server inbound guards", () => {
  it("未认证 socket 发 session.closed 被拒", { timeout: 5000 }, async () => {
    const { server, socket, backend } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_no_auth_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "session.closed",
        payload: {
          sessionId: "sess_fake",
          reason: "user_disconnect",
          closedAt: new Date().toISOString(),
        },
      })));
      const msg = await reader.next("session closed rejected");
      assert.equal(msg.ok, false);
      assert.equal(msg.error.code, "session_required");
      assert.equal(backend.getState().connection.sessionAuthenticated, false);
    } finally {
      socket.close();
      await server.close();
    }
  });

  it("已认证 phone 伪造 job.completed 被拒", { timeout: 5000 }, async () => {
    const { server, socket, identityStore } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      await openSession(socket, reader, identityStore);
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "job.completed",
        payload: {
          jobId: "job_fake_complete",
          affairId: "affair_fake",
          executor: "openclaw",
          status: "completed",
          goal: "forge",
          allowedPermissions: ["workspace.read"],
        },
      })));
      const msg = await reader.next("direction rejected");
      assert.equal(msg.ok, false);
      assert.equal(msg.error.code, "inbound_direction_rejected");
    } finally {
      socket.close();
      await server.close();
    }
  });

  it("needs_permission 取消也要求执行器核实，不凭权限态假造停止", { timeout: 5000 }, async () => {
    let cancelCalled = false;
    const { server, socket, backend, identityStore } = await startHarness({
      onJobCancel: async () => {
        cancelCalled = true;
      },
    });
    const reader = createJsonReader(socket);
    try {
      await openSession(socket, reader, identityStore);
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_cancel_np",
          title: "needs_permission cancel",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: [],
          acceptanceCriteria: [],
          blockedReason: null,
          resumeCondition: null,
          currentJobId: null,
        },
      })));
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "job.create",
        payload: {
          jobId: "job_cancel_np",
          affairId: "affair_cancel_np",
          executor: "openclaw",
          status: "queued",
          goal: "cancel before grant",
          workspaceHint: null,
          allowedPermissions: ["workspace.read"],
        },
      })));
      await reader.nextEnvelope("job.needs_permission");
      await reader.nextEnvelope("permission.request");
      await reader.next("job.create ack");
      assert.equal(backend.getState().jobs.get("job_cancel_np")?.status, "needs_permission");
      assert.equal(backend.listPendingPermissionCards().length, 1);
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "job.cancel",
        payload: { jobId: "job_cancel_np", affairId: "affair_cancel_np" },
      })));
      const cancelAck = await reader.next("job.cancel ack");
      assert.equal(cancelAck.ok, false);
      assert.equal(backend.getState().jobs.get("job_cancel_np")?.status, "needs_permission");
      assert.equal(cancelCalled, true);
      assert.equal(backend.listPendingPermissionCards().length, 0);
    } finally {
      socket.close();
      await server.close();
    }
  });
});
