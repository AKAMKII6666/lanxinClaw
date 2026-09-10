/**
 * Companion protocol server 测试。
 *
 * 职责：验证真实 desktop companion server 可被 simulated phone 驱动。
 * 不拥有：真实 phone 主仓、真实 OpenClaw Gateway、Electron renderer。
 * 副作用：监听本机随机端口。
 */

import {
PROTOCOL_VERSION,
createEnvelope,
} from "@lanxin-claw/protocol";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import WebSocket from "ws";
import { createSessionAuthProof } from "../../src/credentials/auth-proof.js";
import {
createJsonReader,
openSession,
startHarness,
waitFor,
} from "./harness.js";

describe("companion protocol server", () => {

  it("空 allowedPermissions 被拒绝且不入队", { timeout: 5000 }, async () => {
    const { server, socket, backend, identityStore } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      await openSession(socket, reader, identityStore);
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_empty_perm",
          title: "空权限事务",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: [],
          acceptanceCriteria: [],
          blockedReason: null,
          resumeCondition: null,
          currentJobId: null,
        },
      })));
      assert.equal((await reader.next("affair.create ack")).ok, true);
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "job.create",
        payload: {
          jobId: "job_empty_perm",
          affairId: "affair_empty_perm",
          executor: "openclaw",
          status: "queued",
          goal: "should fail",
          workspaceHint: null,
          allowedPermissions: [],
        },
      })));
      const msg = await reader.next("empty permissions");
      assert.equal(msg.ok, false);
      assert.equal(msg.error.code, "job_permissions_required");
      assert.equal(backend.listPendingPermissionCards().length, 0);
    } finally {
      socket.close();
      await server.close();
    }
  });

  it("job.create 向已认证 phone 推 needs_permission；旁听收不到业务流", { timeout: 8000 }, async () => {
    const { server, socket, identityStore, backend } = await startHarness();
    const reader = createJsonReader(socket);
    const eavesdrop = new WebSocket(server.wsUrl);
    await new Promise<void>((resolve, reject) => {
      eavesdrop.once("open", resolve);
      eavesdrop.once("error", reject);
    });
    const spy = createJsonReader(eavesdrop);
    try {
      await openSession(socket, reader, identityStore);
      while (spy.queuedLength() > 0) {
        await spy.next("drain pairing/session");
      }
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_perm_001",
          title: "权限出站",
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
          jobId: "job_perm_001",
          affairId: "affair_perm_001",
          executor: "openclaw",
          status: "queued",
          goal: "need perm",
          workspaceHint: "F:/ws",
          allowedPermissions: ["workspace.read"],
        },
      })));
      const affairAck = await reader.next("affair.create ack");
      assert.equal(affairAck.ok, true);
      assert.equal(affairAck.acceptedType, "affair.create");
      await reader.nextEnvelope("job.needs_permission");
      await reader.nextEnvelope("permission.request");
      const createAck = await reader.next("job.create ack");
      assert.equal(createAck.ok, true);
      assert.equal(createAck.acceptedType, "job.create");
      assert.equal(backend.listPendingPermissionCards().length, 1);
      assert.equal(backend.getPermissionGate().hasPendingForJob("job_perm_001"), true);
      const leaked: Array<{ type?: string }> = [];
      while (spy.queuedLength() > 0) {
        leaked.push(await spy.next("eavesdrop leftover"));
      }
      const business = leaked.filter(
        (item) =>
          typeof item.type === "string" &&
          !item.type.startsWith("pairing.") &&
          !item.type.startsWith("session."),
      );
      assert.equal(business.length, 0);
    } finally {
      eavesdrop.close();
      socket.close();
      await server.close();
    }
  });

  it("job.cancel handler 未提交停止证据时拒绝成功回执", { timeout: 5000 }, async () => {
    const cancelled: Array<{ jobId: string; affairId: string }> = [];
    const { server, socket, backend, identityStore } = await startHarness({
      onJobCancel: async (input) => {
        cancelled.push(input);
      },
    });
    const reader = createJsonReader(socket);
    try {
      await openSession(socket, reader, identityStore);
      backend.getState().jobs.set("job_cancel_001", {
        jobId: "job_cancel_001",
        affairId: "affair_cancel_001",
        executor: "openclaw",
        status: "running",
        goal: "cancel me",
        workspaceHint: null,
        allowedPermissions: ["workspace.read"],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      });
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "job.cancel",
        payload: { jobId: "job_cancel_001", affairId: "affair_cancel_001" },
      })));
      const msg = await reader.next("job.cancel ack");
      assert.equal(msg.ok, false);
      assert.equal(backend.getState().jobs.get("job_cancel_001")?.status, "running");
      assert.equal(cancelled.length, 1);
      assert.equal(cancelled[0]?.jobId, "job_cancel_001");
    } finally {
      socket.close();
      await server.close();
    }
  });

  it("job.cancel 无 onJobCancel 时拒绝假取消", { timeout: 5000 }, async () => {
    const { server, socket, backend, identityStore } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      await openSession(socket, reader, identityStore);
      backend.getState().jobs.set("job_cancel_002", {
        jobId: "job_cancel_002",
        affairId: "affair_cancel_002",
        executor: "openclaw",
        status: "queued",
        goal: "cancel fallback",
        workspaceHint: null,
        allowedPermissions: ["workspace.read"],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      });
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "job.cancel",
        payload: { jobId: "job_cancel_002", affairId: "affair_cancel_002" },
      })));
      const reply = await reader.next("job.cancel ack");
      assert.equal(reply.ok, false);
      assert.equal(backend.getState().jobs.get("job_cancel_002")?.status, "queued");
    } finally {
      socket.close();
      await server.close();
    }
  });

  it("pairing + session + affair/job/chat 最小闭环", { timeout: 5000 }, async () => {
    const { server, socket, identityStore, backend } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      const pairing = createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "pairing.request",
        payload: {
          pairingId: "pair_srv_001",
          phoneDeviceId: "phone_srv_001",
          phoneDisplayName: "phone",
          protocolVersion: PROTOCOL_VERSION,
          capabilities: [],
        },
      });
      socket.send(JSON.stringify(pairing));
      const challenge = await reader.nextEnvelope("pairing.challenge");
      assert.equal(challenge.type, "pairing.challenge");

      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "pairing.confirmed",
        payload: {
          pairingId: "pair_srv_001",
          challengeResponse: String((challenge.payload as { challenge: string }).challenge),
          phoneConfirmedAt: new Date().toISOString(),
        },
      })));
      assert.equal((await reader.next("pairing.confirmed ack")).ok, true);
      const approved = await backend.applyBridgeAction({
        type: "pairing.approve",
        pairingId: "pair_srv_001",
      });
      assert.equal(approved.ok, true);
      assert.equal((await reader.nextEnvelope("pairing.desktop_approved")).type, "pairing.desktop_approved");
      assert.equal((await reader.nextEnvelope("pairing.completed")).type, "pairing.completed");

      const identity = await identityStore.findIdentity("phone_srv_001", "desktop_srv_001");
      assert.ok(identity?.pairingSecret);
      const sessionId = "sess_srv_001";
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "session.open",
        payload: {
          sessionId,
          phoneDeviceId: "phone_srv_001",
          desktopDeviceId: "desktop_srv_001",
          authProof: createSessionAuthProof(identity.pairingSecret, sessionId),
          protocolVersion: PROTOCOL_VERSION,
        },
      })));
      assert.equal((await reader.nextEnvelope("session.accepted")).type, "session.accepted");

      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_srv_001",
          title: "真实 companion server 验收",
          ownerAgent: "zhang-boss",
          status: "running",
          context: [],
          acceptanceCriteria: ["snapshot 更新"],
          currentJobId: "job_srv_001",
        },
      })));
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "job.create",
        payload: {
          jobId: "job_srv_001",
          affairId: "affair_srv_001",
          executor: "openclaw",
          status: "queued",
          goal: "server job",
          workspaceHint: "F:/workspace/demo",
          allowedPermissions: ["workspace.read"],
        },
      })));
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "chat.message",
        payload: {
          chatMessageId: "chat_srv_001",
          text: "补充上下文",
          authorKind: "user",
          sentAt: new Date().toISOString(),
          affairId: "affair_srv_001",
        },
      })));
      await waitFor(() => backend.getSnapshot().currentAffair?.affairId === "affair_srv_001");
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(backend.listPendingPermissionCards().length, 1);
      assert.equal(backend.getPermissionGate().hasPendingForJob("job_srv_001"), true);
      assert.equal(backend.getState().chatMessages.length, 1);
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "chat.message",
        payload: {
          chatMessageId: "chat_srv_zhang",
          text: "张老板补充",
          authorKind: "zhang-boss",
          sentAt: new Date().toISOString(),
          affairId: "affair_srv_001",
        },
      })));
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "chat.message",
        payload: {
          chatMessageId: "chat_srv_spoof",
          text: "不能冒充 companion",
          authorKind: "companion",
          sentAt: new Date().toISOString(),
          affairId: "affair_srv_001",
        },
      })));
      await waitFor(() => backend.getState().chatMessages.length === 3);
      assert.equal(backend.getState().chatMessages[1]?.authorKind, "zhang-boss");
      assert.equal(backend.getState().chatMessages[2]?.authorKind, "user");
    } finally {
      socket.close();
      await server.close();
    }
  });

  it("未知 allowedPermissions 全部滤掉后拒绝", { timeout: 5000 }, async () => {
    const { server, socket, backend, identityStore } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      await openSession(socket, reader, identityStore);
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "affair.create",
        payload: {
          affairId: "affair_unknown_perm",
          title: "未知权限",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: [],
          acceptanceCriteria: [],
          blockedReason: null,
          resumeCondition: null,
          currentJobId: null,
        },
      })));
      assert.equal((await reader.next("affair.create ack")).ok, true);
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "job.create",
        payload: {
          jobId: "job_unknown_perm",
          affairId: "affair_unknown_perm",
          executor: "openclaw",
          status: "queued",
          goal: "unknown perm",
          workspaceHint: null,
          allowedPermissions: ["not.a.real.permission"],
        },
      })));
      const msg = await reader.next("unknown permissions");
      assert.equal(msg.ok, false);
      assert.equal(msg.error.code, "unknown_permission_ids");
      assert.equal(backend.getState().jobs.has("job_unknown_perm"), false);
    } finally {
      socket.close();
      await server.close();
    }
  });

  it("chat.read_receipt 写入 store；GET /snapshot 本机可访问", { timeout: 5000 }, async () => {
    const { server, socket, backend, identityStore } = await startHarness();
    const reader = createJsonReader(socket);
    try {
      await openSession(socket, reader, identityStore);
      backend.getPendingContext().enqueue({ sourceId: "chat_srv_001", sourceKind: "message",
        phoneDeviceId: "phone_srv_001", desktopDeviceId: "desktop_srv_001", text: "原消息",
        target: "active_call", contentKind: "note", affairId: null });
      socket.send(JSON.stringify(createEnvelope({
        source: { kind: "phone", deviceId: "phone_srv_001" },
        target: { kind: "companion", deviceId: "desktop_srv_001" },
        type: "chat.read_receipt",
        payload: {
          chatMessageId: "chat_srv_001",
          readAt: new Date().toISOString(),
        },
      })));
      assert.equal((await reader.next("read_receipt ack")).ok, true);
      assert.equal(backend.getState().chatReceipts.length, 1);
      const health = await fetch(`${server.baseUrl}/health`);
      assert.equal(health.status, 200);
      const snapshot = await fetch(`${server.baseUrl}/snapshot`);
      assert.equal(snapshot.status, 200);
    } finally {
      socket.close();
      await server.close();
    }
  });
});

import { createCaptureLogger } from "./support/capture-logger.js";
