/**
 * simulated phone 驱动真实 desktop companion protocol server。
 *
 * 职责：验证真实 companion server + backend store + permission gate + adapter mock 最小闭环。
 * 不拥有：真实 phone 主仓、真实 OpenClaw Gateway、Electron renderer。
 * 副作用：监听本机随机端口，并建立本机 WebSocket 连接。
 */

import WebSocket from "ws";
import {
  PROTOCOL_VERSION,
  createAffairId,
  createEnvelope,
  createJobId,
  createSessionId,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import {
  OpenClawAdapter,
  createMutableMockOpenClawRuntimeClient,
} from "@lanxin-claw/openclaw-adapter";
import { createCompanionBackendRuntime } from "../../apps/companion/src/backend/runtime.js";
import { createSessionAuthProof } from "../../apps/companion/src/credentials/auth-proof.js";
import {
  MemoryIdentityPersistence,
  createDeviceIdentityStore,
} from "../../apps/companion/src/credentials/identity-store.js";
import { startCompanionProtocolServer } from "../../apps/companion/src/protocol-server/server.js";

const PHONE_DEVICE_ID = "phone_sim_real_companion_001";
const DESKTOP_DEVICE_ID = "desktop_real_companion_001";

/**
 * 主流程。
 */
async function main(): Promise<void> {
  const backend = createCompanionBackendRuntime();
  const identityStore = createDeviceIdentityStore(new MemoryIdentityPersistence());
  const runtime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const server = await startCompanionProtocolServer({
    backend,
    identityStore,
    pairing: {
      desktopDeviceId: DESKTOP_DEVICE_ID,
      desktopDisplayName: "Lanxin Companion",
    },
  });
  const phone = new PhoneClient(server.wsUrl);

  try {
    await phone.open();
    const pairingId = "pair_real_companion_001";
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "pairing.request",
      payload: {
        pairingId,
        phoneDeviceId: PHONE_DEVICE_ID,
        phoneDisplayName: "模拟澜星电话",
        protocolVersion: PROTOCOL_VERSION,
        capabilities: ["affair", "job", "chat"],
      },
    }));
    const challenge = await phone.nextEnvelope("pairing.challenge");
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "pairing.confirmed",
      correlationId: challenge.messageId,
      payload: {
        pairingId,
        challengeResponse: String((challenge.payload as { challenge: string }).challenge),
        phoneConfirmedAt: new Date().toISOString(),
      },
    }));
    await phone.nextJson("pairing.confirmed ack");
    await server.approvePairing(pairingId);
    await phone.nextEnvelope("pairing.desktop_approved");
    await phone.nextEnvelope("pairing.completed");

    const identity = await identityStore.findIdentity(PHONE_DEVICE_ID, DESKTOP_DEVICE_ID);
    if (!identity?.pairingSecret) {
      throw new Error("identity store 未写入 pairing secret");
    }
    const sessionId = createSessionId();
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "session.open",
      payload: {
        sessionId,
        phoneDeviceId: PHONE_DEVICE_ID,
        desktopDeviceId: DESKTOP_DEVICE_ID,
        authProof: createSessionAuthProof(identity.pairingSecret, sessionId),
        protocolVersion: PROTOCOL_VERSION,
      },
    }));
    await phone.nextEnvelope("session.accepted");

    const affairId = createAffairId();
    const jobId = createJobId();
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "affair.create",
      payload: {
        affairId,
        title: "真实 companion 协议闭环",
        ownerAgent: "zhang-boss",
        status: "running",
        context: ["scripts/sim-phone/run-real-companion-loop.ts"],
        acceptanceCriteria: ["job 先进入 needs_permission", "授权后 adapter mock 被调用"],
        currentJobId: jobId,
      },
    }));
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "job.create",
      payload: {
        jobId,
        affairId,
        executor: "openclaw",
        status: "queued",
        goal: "simulated phone real companion job",
        workspaceHint: "F:/workspace/demo",
        allowedPermissions: ["workspace.read", "command.run"],
      },
    }));
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "chat.message",
      payload: {
        chatMessageId: "chat_real_companion_001",
        text: "补充执行上下文",
        authorKind: "user",
        sentAt: new Date().toISOString(),
        affairId,
      },
    }));

    await waitFor(() => backend.getState().jobs.get(jobId)?.status === "needs_permission", "job needs_permission");
    const card = backend.listPendingPermissionCards()[0];
    if (!card) {
      throw new Error("job.create 未进入 permission gate");
    }
    const decision = await backend.applyBridgeAction({
      type: "permission.decide",
      permissionRequestId: card.permissionRequestId,
      decision: "allow_for_job",
    });
    if (!decision.ok) {
      throw new Error(`permission decide failed: ${decision.error.message}`);
    }
    if (!backend.getBridgeHost().isPermissionGranted(jobId, "command.run")) {
      throw new Error("授权后 command.run grant 不可用");
    }

    const delegated = await adapter.createJob({
      jobId,
      affairId,
      goal: "simulated phone real companion job",
      workspaceHint: "F:/workspace/demo",
      allowedPermissions: ["workspace.read", "command.run"],
    });
    if (!delegated.ok) {
      throw new Error(`adapter mock delegation failed: ${delegated.message}`);
    }
    runtime.advance({
      runId: delegated.job.openclawRunId ?? "",
      status: "completed",
      patch: { summary: "adapter mock completed after permission grant" },
    });
    const read = await adapter.readJob(jobId);
    if (!read.ok || read.job.status !== "completed") {
      throw new Error(`adapter mock 未完成，status=${read.ok ? read.job.status : read.message}`);
    }

    process.stdout.write(
      `[sim-phone-real] ok baseUrl=${server.baseUrl} job=${jobId} status=${read.job.status} pending=${backend.listPendingPermissionCards().length}\n`,
    );
  } finally {
    phone.close();
    await server.close();
  }
}

/**
 * 测试用 phone WS 客户端。
 */
class PhoneClient {
  readonly #socket: WebSocket;
  readonly #queue: unknown[] = [];
  readonly #waiters: Array<(value: unknown) => void> = [];

  /**
   * @param wsUrl WebSocket 地址
   */
  constructor(wsUrl: string) {
    this.#socket = new WebSocket(wsUrl);
    this.#socket.on("message", (data) => {
      const value = JSON.parse(data.toString()) as unknown;
      const waiter = this.#waiters.shift();
      if (waiter) {
        waiter(value);
        return;
      }
      this.#queue.push(value);
    });
  }

  /**
   * 等待连接打开。
   */
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket.once("open", resolve);
      this.#socket.once("error", reject);
    });
  }

  /**
   * 发送 envelope。
   */
  send(envelope: ProtocolEnvelope): void {
    this.#socket.send(JSON.stringify(envelope));
  }

  /**
   * 读取下一条 JSON。
   */
  async nextJson(label: string): Promise<any> {
    if (this.#queue.length > 0) {
      return this.#queue.shift();
    }
    return await new Promise((resolve, reject) => {
      const waiter = (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) {
          this.#waiters.splice(index, 1);
        }
        reject(new Error(`等待 ${label} 超时`));
      }, 5_000);
      this.#waiters.push(waiter);
    });
  }

  /**
   * 读取下一条 envelope。
   */
  async nextEnvelope(label: string): Promise<ProtocolEnvelope> {
    return (await this.nextJson(label)) as ProtocolEnvelope;
  }

  /**
   * 关闭连接。
   */
  close(): void {
    this.#socket.terminate();
  }
}

/**
 * 等待条件成立。
 */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5_000) {
      throw new Error(`等待 ${label} 超时`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[sim-phone-real] FAILED ${message}\n`);
  process.exitCode = 1;
});
