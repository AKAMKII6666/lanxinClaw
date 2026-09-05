/**
 * protocol server 集成测试 harness。
 */

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
import { startCompanionProtocolServer, type CompanionProtocolServerOptions } from "../../src/protocol-server/server.js";

/**
 * 启动测试 harness。
 *
 * @param options 可选 server 选项
 * @returns harness 依赖
 */
export async function startHarness(
  options: Partial<
    Pick<
      CompanionProtocolServerOptions,
      "heartbeatIntervalMs" | "missedHeartbeats" | "onJobCancel" | "logger"
    >
  > = {},
) {
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
    ...options,
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
 *
 * @param socket WebSocket
 * @returns 读取器
 */
export function createJsonReader(socket: WebSocket): {
  next: (label?: string) => Promise<any>;
  nextEnvelope: (label?: string) => Promise<ProtocolEnvelope>;
  queuedLength: () => number;
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
    nextEnvelope: async (label?: string) => {
      for (;;) {
        const value = (await next(label)) as ProtocolEnvelope;
        if (!label || !label.includes(".") || value.type === label) {
          return value;
        }
      }
    },
    queuedLength: () => queue.length,
  };
}

/**
 * 完成配对并 session.open，使该 socket 成为已认证业务通道。
 *
 * @param socket WebSocket 连接
 * @param reader 消息读取器
 * @param identityStore 设备身份存储
 */
export async function openSession(
  socket: WebSocket,
  reader: ReturnType<typeof createJsonReader>,
  identityStore: ReturnType<typeof createDeviceIdentityStore>,
): Promise<void> {
  socket.send(JSON.stringify(createEnvelope({
    source: { kind: "phone", deviceId: "phone_srv_001" },
    target: { kind: "companion", deviceId: "desktop_srv_001" },
    type: "pairing.request",
    payload: {
      pairingId: "pair_open_session",
      phoneDeviceId: "phone_srv_001",
      phoneDisplayName: "phone",
      protocolVersion: PROTOCOL_VERSION,
      capabilities: [],
    },
  })));
  const challenge = await reader.nextEnvelope("pairing.challenge");
  socket.send(JSON.stringify(createEnvelope({
    source: { kind: "phone", deviceId: "phone_srv_001" },
    target: { kind: "companion", deviceId: "desktop_srv_001" },
    type: "pairing.confirmed",
    payload: {
      pairingId: "pair_open_session",
      challengeResponse: String((challenge.payload as { challenge: string }).challenge),
      phoneConfirmedAt: new Date().toISOString(),
    },
  })));
  await reader.next("pairing.confirmed ack");
  const approved = await identityStore.savePairedIdentity({
    pairingId: "pair_open_session",
    phoneDeviceId: "phone_srv_001",
    phoneDisplayName: "phone",
    desktopDeviceId: "desktop_srv_001",
    desktopDisplayName: "desktop",
    pairedAt: new Date().toISOString(),
  });
  const sessionId = "sess_open_helper";
  socket.send(JSON.stringify(createEnvelope({
    source: { kind: "phone", deviceId: "phone_srv_001" },
    target: { kind: "companion", deviceId: "desktop_srv_001" },
    type: "session.open",
    payload: {
      sessionId,
      phoneDeviceId: "phone_srv_001",
      desktopDeviceId: "desktop_srv_001",
      authProof: createSessionAuthProof(approved.pairingSecret ?? "", sessionId),
      protocolVersion: PROTOCOL_VERSION,
    },
  })));
  await reader.nextEnvelope("session.accepted");
}

/**
 * 等待条件成立。
 *
 * @param predicate 条件
 */
export async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
