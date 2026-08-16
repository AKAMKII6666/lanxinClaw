/**
 * Companion protocol server 测试。
 *
 * 职责：验证真实 desktop companion server 可被 simulated phone 驱动。
 * 不拥有：真实 phone 主仓、真实 OpenClaw Gateway、Electron renderer。
 * 副作用：监听本机随机端口。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import WebSocket from "ws";
import {
  PROTOCOL_VERSION,
  createEnvelope,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../src/backend/runtime.js";
import { createSessionAuthProof } from "../../src/credentials/auth-proof.js";
import {
  MemoryIdentityPersistence,
  createDeviceIdentityStore,
} from "../../src/credentials/identity-store.js";
import { startCompanionProtocolServer } from "../../src/protocol-server/server.js";

describe("companion protocol server", () => {
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
      assert.equal(backend.listPendingPermissionCards().length, 1);
      assert.equal(backend.getState().jobs.get("job_srv_001")?.status, "needs_permission");
      assert.equal(backend.getState().chatMessages.length, 1);
    } finally {
      socket.close();
      await server.close();
    }
  });
});

/**
 * 启动测试 harness。
 */
async function startHarness() {
  const identityStore = createDeviceIdentityStore(new MemoryIdentityPersistence());
  let server: Awaited<ReturnType<typeof startCompanionProtocolServer>>;
  const backend = createCompanionBackendRuntime({
    onBridgeAction: async (action) => {
      if (action.type === "pairing.approve") {
        await server.approvePairing(action.pairingId);
      }
    },
  });
  server = await startCompanionProtocolServer({
    backend,
    identityStore,
    pairing: {
      desktopDeviceId: "desktop_srv_001",
      desktopDisplayName: "desktop",
    },
  });
  const socket = new WebSocket(server.wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { backend, identityStore, server, socket };
}

/**
 * 读取下一条 JSON。
 */
function createJsonReader(socket: WebSocket): {
  next: (label?: string) => Promise<any>;
  nextEnvelope: (label?: string) => Promise<ProtocolEnvelope>;
} {
  const queue: unknown[] = [];
  const waiters: Array<(value: unknown) => void> = [];
  socket.on("message", (data) => {
    const value = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) {
      waiter(value);
      return;
    }
    queue.push(value);
  });
  const next = async (label = "message") => {
    if (queue.length > 0) {
      return queue.shift();
    }
    return await new Promise((resolve, reject) => {
      const waiter = (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(new Error(`nextJson timeout: ${label}`));
      }, 1000);
      waiters.push(waiter);
    });
  };
  return {
    next,
    nextEnvelope: async (label?: string) => (await next(label)) as ProtocolEnvelope,
  };
}

/**
 * 等待条件成立。
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
