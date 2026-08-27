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
import { JobDelegator } from "../../apps/companion/src/jobs/delegation/delegator.js";
import { buildPermissionDecisionEnvelope } from "../../apps/companion/src/protocol-server/outbound-envelopes.js";

const PHONE_DEVICE_ID = "phone_sim_real_companion_001";
const DESKTOP_DEVICE_ID = "desktop_real_companion_001";

/**
 * 主流程。
 */
async function main(): Promise<void> {
  const runtime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  let protocolServer: Awaited<ReturnType<typeof startCompanionProtocolServer>>;
  const backend = createCompanionBackendRuntime({
    onBridgeAction: async (action, result) => {
      if (action.type === "permission.decide" && result.ok) {
        const phoneDeviceId = backend.getState().connection.phoneDeviceId;
        const request = backend.getPermissionGate().getRequest(action.permissionRequestId);
        if (phoneDeviceId) {
          protocolServer.broadcast(
            buildPermissionDecisionEnvelope(
              { desktopDeviceId: DESKTOP_DEVICE_ID, phoneDeviceId },
              {
                permissionRequestId: action.permissionRequestId,
                jobId: request?.jobId,
                decision: action.decision,
                decidedAt: new Date().toISOString(),
              },
            ),
          );
        }
        if (action.decision === "allow_once" || action.decision === "allow_for_job") {
          await delegator.handlePermissionGranted(action.permissionRequestId);
        } else {
          delegator.rejectPermission(
            action.permissionRequestId,
            action.decision === "deny" ? "permission_denied" : "require_more_context",
          );
        }
      }
    },
  });
  const delegator = new JobDelegator({
    adapter,
    gate: backend.getPermissionGate(),
    getJobStatus: (jobId) => backend.getState().jobs.get(jobId)?.status,
    getWorkspaceHint: (jobId) => backend.getState().jobs.get(jobId)?.workspaceHint ?? null,
    getAffair: (affairId) => backend.getState().affairs.get(affairId),
    getPhoneDeviceId: () => backend.getState().connection.phoneDeviceId,
    desktopDeviceId: DESKTOP_DEVICE_ID,
    applyProtocolEnvelope: (envelope) => backend.applyProtocolEnvelope(envelope),
    sendEnvelope: (envelope) => protocolServer?.sendEnvelope(envelope),
    pollIntervalMs: 50,
  });
  const identityStore = createDeviceIdentityStore(new MemoryIdentityPersistence());
  protocolServer = await startCompanionProtocolServer({
    backend,
    identityStore,
    pairing: {
      desktopDeviceId: DESKTOP_DEVICE_ID,
      desktopDisplayName: "Lanxin Companion",
    },
    onJobCancel: (input) => delegator.cancelJob(input),
  });
  const phone = new PhoneClient(protocolServer.wsUrl);

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
    await protocolServer.approvePairing(pairingId);
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

    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "affair.create",
      payload: {
        affairId: "affair_empty_perm_e2e",
        title: "空权限",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: [],
        currentJobId: null,
      },
    }));
    await phone.nextJson("affair.create ack");
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "job.create",
      payload: {
        jobId: "job_empty_perm_e2e",
        affairId: "affair_empty_perm_e2e",
        executor: "openclaw",
        status: "queued",
        goal: "empty permissions must fail",
        workspaceHint: null,
        allowedPermissions: [],
      },
    }));
    const rejected = await phone.nextJson("empty permissions");
    if (rejected?.ok !== false || rejected?.error?.code !== "job_permissions_required") {
      throw new Error(`空权限应拒绝，实际 ${JSON.stringify(rejected)}`);
    }

    const affairId = createAffairId();
    const denyJobId = createJobId();
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "affair.create",
      payload: {
        affairId,
        title: "deny 分支验收",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: ["deny 闭环"],
        currentJobId: denyJobId,
      },
    }));
    phone.send(createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "job.create",
      payload: {
        jobId: denyJobId,
        affairId,
        executor: "openclaw",
        status: "queued",
        goal: "deny path",
        workspaceHint: "F:/workspace/demo",
        allowedPermissions: ["workspace.read"],
      },
    }));
    assertCompanionToPhone(await phone.nextEnvelope("job.needs_permission"));
    assertCompanionToPhone(await phone.nextEnvelope("permission.request"));
    const denyAck = await phone.nextJson("job.create deny ack");
    if (denyAck?.ok !== true || denyAck?.acceptedType !== "job.create") {
      throw new Error(`job.create ack 缺失: ${JSON.stringify(denyAck)}`);
    }
    const denyCard = backend.listPendingPermissionCards()[0];
    if (!denyCard) {
      throw new Error("deny 分支未进入 permission gate");
    }
    const denyDecided = await backend.applyBridgeAction({
      type: "permission.decide",
      permissionRequestId: denyCard.permissionRequestId,
      decision: "deny",
    });
    if (!denyDecided.ok) {
      throw new Error(`deny decide failed: ${denyDecided.error.message}`);
    }
    assertCompanionToPhone(await phone.nextEnvelope("permission.decision"));
    assertCompanionToPhone(await phone.nextEnvelope("job.failed"));
    if (backend.getState().jobs.get(denyJobId)?.status !== "failed") {
      throw new Error("deny 后 job 应 failed");
    }

    const jobId = createJobId();
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
    assertCompanionToPhone(await phone.nextEnvelope("job.needs_permission"));
    assertCompanionToPhone(await phone.nextEnvelope("permission.request"));
    const createAck = await phone.nextJson("job.create ack");
    if (createAck?.ok !== true || createAck?.acceptedType !== "job.create") {
      throw new Error(`job.create ack 缺失: ${JSON.stringify(createAck)}`);
    }
    const card = backend.listPendingPermissionCards()[0];
    if (!card) {
      throw new Error("job.create 未进入 permission gate");
    }
    const decided = await backend.applyBridgeAction({
      type: "permission.decide",
      permissionRequestId: card.permissionRequestId,
      decision: "allow_once",
    });
    if (!decided.ok) {
      throw new Error(`permission decide failed: ${decided.error.message}`);
    }
    await phone.nextEnvelope("permission.decision");
    if (backend.getBridgeHost().isPermissionGranted(jobId, "command.run")) {
      throw new Error("allow_once 应在委派 createRun 前被消耗");
    }
    assertCompanionToPhone(await phone.nextEnvelope("job.accepted"));

    const delegated = await adapter.readJob(jobId);
    if (!delegated.ok || !delegated.job.openclawRunId) {
      throw new Error("delegator 未创建 adapter job 或缺少 runId");
    }
    runtime.advance({
      runId: delegated.job.openclawRunId,
      status: "completed",
      patch: { summary: "adapter mock completed after permission grant" },
    });
    await phone.nextEnvelope("job.completed");
    assertCompanionToPhone(await phone.nextEnvelope("affair.update"));

    process.stdout.write(
      `[sim-phone-real] ok baseUrl=${protocolServer.baseUrl} job=${jobId} status=completed pending=${backend.listPendingPermissionCards().length}\n`,
    );
  } finally {
    phone.close();
    delegator.stop();
    await protocolServer.close();
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
    for (;;) {
      const value = (await this.nextJson(label)) as ProtocolEnvelope;
      if (!label.includes(".") || value.type === label) {
        return value;
      }
    }
  }

  /**
   * 关闭连接。
   */
  close(): void {
    this.#socket.terminate();
  }
}

/**
 * 断言 companion→phone 出站方向。
 *
 * @param envelope 协议 envelope
 */
function assertCompanionToPhone(envelope: ProtocolEnvelope): void {
  if (envelope.source.kind !== "companion" || envelope.target.kind !== "phone") {
    throw new Error(
      `出站方向错误 type=${envelope.type} source=${envelope.source.kind} target=${envelope.target.kind}`,
    );
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
