/**
 * v1.3 端到端验收：电话模拟事件流 + OpenClaw adapter + 监督 tick + 控制面板快照。
 *
 * 职责：验证 blocked/resume 语义、waiting_acceptance 不自动 closed、adapter job 可读。
 * 不拥有：真实电话 UI、真实 OpenClaw Gateway、桌面权限确认弹窗。
 * 副作用：启动本机 mock companion、连接 WS、创建 adapter mock job。
 */

import {
  PROTOCOL_VERSION,
  createAffairId,
  createEnvelope,
  createJobId,
  createMessageId,
  createPairingId,
  createSessionId,
  validateControlPanelSnapshot,
  validateMessage,
  type ProtocolEnvelope,
} from "@lanxin-claw/protocol";
import {
  OpenClawAdapter,
  createMutableMockOpenClawRuntimeClient,
} from "@lanxin-claw/openclaw-adapter";
import { startMockCompanion } from "@lanxin-claw/mock-companion";
import {
  createSupervisionNotifyMemory,
  rememberBlockedNotify,
  runSupervisionTick,
} from "../../apps/companion/src/supervision/tick.js";
import {
  affairStatusAfterJobTerminal,
  affairStatusAfterUserAcceptance,
  detectIllegalAutoClose,
} from "../../apps/companion/src/supervision/policy/acceptance.js";
import { createMemoryAuditStore } from "../../apps/companion/src/audit/memory-store.js";

const PHONE_DEVICE_ID = "phone_sim_v13_001";
const PHONE_DISPLAY_NAME = "模拟澜星电话 v1.3";

/**
 * @param ws WebSocket
 * @returns Promise
 */
function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 5_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * @param ws WebSocket
 * @param envelope 协议消息
 */
function sendEnvelope(ws: WebSocket, envelope: ProtocolEnvelope): void {
  ws.send(JSON.stringify(envelope));
}

/**
 * @param events 事件列表
 * @param predicate 条件
 * @param timeoutMs 超时
 * @returns 事件
 */
async function waitForEvent(
  events: ProtocolEnvelope[],
  predicate: (item: ProtocolEnvelope) => boolean,
  timeoutMs: number,
): Promise<ProtocolEnvelope> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = events.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`waitForEvent timeout after ${timeoutMs}ms`);
}

/**
 * 主流程。
 */
async function main(): Promise<void> {
  const audit = createMemoryAuditStore();
  const mockRuntime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: mockRuntime.client });

  const companion = await startMockCompanion({
    port: 0,
    jobScenario: "completed",
    stepDelayMs: 30,
  });

  const events: ProtocolEnvelope[] = [];
  const ws = new WebSocket(companion.wsUrl);
  ws.addEventListener("message", (msg) => {
    const raw = JSON.parse(String(msg.data)) as unknown;
    if (raw && typeof raw === "object" && "ok" in (raw as object) && (raw as { ok?: boolean }).ok === false) {
      process.stderr.write(`[e2e-v13] error frame ${JSON.stringify(raw)}\n`);
      return;
    }
    const validated = validateMessage(raw);
    if (!validated.ok) {
      process.stderr.write(`[e2e-v13] invalid outbound ${validated.error.message}\n`);
      return;
    }
    events.push(validated.value);
    process.stdout.write(`[e2e-v13] <- ${validated.value.type}\n`);
  });

  try {
    await waitOpen(ws);
    const desktopId = companion.config.desktopDeviceId;
    const pairingId = createPairingId();

    sendEnvelope(
      ws,
      createEnvelope({
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "pairing.request",
        payload: {
          pairingId,
          phoneDeviceId: PHONE_DEVICE_ID,
          phoneDisplayName: PHONE_DISPLAY_NAME,
          protocolVersion: PROTOCOL_VERSION,
          capabilities: ["affair", "job", "chat"],
        },
      }),
    );

    const challenge = await waitForEvent(events, (e) => e.type === "pairing.challenge", 5_000);
    const challengePayload = challenge.payload as { challenge: string };

    sendEnvelope(
      ws,
      createEnvelope({
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "pairing.confirmed",
        correlationId: challenge.messageId,
        payload: {
          pairingId,
          challengeResponse: challengePayload.challenge,
          phoneConfirmedAt: new Date().toISOString(),
        },
      }),
    );
    await waitForEvent(events, (e) => e.type === "pairing.completed", 5_000);
    audit.append({
      kind: "pairing",
      summary: "模拟电话完成双确认配对",
      outcome: "completed",
    });

    const authProof = `mock-paired:${pairingId}`;
    const sessionId = createSessionId();
    sendEnvelope(
      ws,
      createEnvelope({
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "session.open",
        payload: {
          sessionId,
          phoneDeviceId: PHONE_DEVICE_ID,
          desktopDeviceId: desktopId,
          authProof,
          protocolVersion: PROTOCOL_VERSION,
        },
      }),
    );
    await waitForEvent(events, (e) => e.type === "session.accepted", 5_000);

    const affairId = createAffairId();
    const jobId = createJobId();
    sendEnvelope(
      ws,
      createEnvelope({
        messageId: createMessageId(),
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "affair.create",
        payload: {
          affairId,
          title: "v1.3 e2e：验收与监督",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: ["scripts/e2e/run-v1-3-loop.ts"],
          acceptanceCriteria: ["mock job.completed", "affair 进入 waiting_acceptance"],
          blockedReason: null,
          resumeCondition: null,
          currentJobId: null,
        },
      }),
    );
    await waitForEvent(events, (e) => e.type === "affair.update", 5_000);

    sendEnvelope(
      ws,
      createEnvelope({
        messageId: createMessageId(),
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "job.create",
        payload: {
          jobId,
          affairId,
          executor: "openclaw",
          status: "queued",
          goal: "e2e mock workspace",
          workspaceHint: "F:/workspace/example",
          allowedPermissions: ["workspace.read", "command.run"],
          progressSummary: "",
          blockedReason: null,
          resumeCondition: null,
          permissionRequestId: null,
        },
      }),
    );

    await waitForEvent(events, (e) => e.type === "job.accepted", 5_000);
    await waitForEvent(events, (e) => e.type === "job.progress", 5_000);
    await waitForEvent(events, (e) => e.type === "job.completed", 5_000);
    await waitForEvent(
      events,
      (e) =>
        e.type === "affair.update" &&
        (e.payload as { status?: string }).status === "waiting_acceptance",
      5_000,
    );

    const closedAuto = events.some(
      (e) =>
        e.type === "affair.update" && (e.payload as { status?: string }).status === "closed",
    );
    if (closedAuto) {
      throw new Error("违规：worker completed 被映射为 affair closed");
    }

    const next = affairStatusAfterJobTerminal("completed");
    if (next !== "waiting_acceptance") {
      throw new Error("验收策略未将 completed 映射为 waiting_acceptance");
    }
    if (detectIllegalAutoClose("closed", "completed")) {
      // expected helper works
    } else {
      throw new Error("detectIllegalAutoClose 未检出非法 closed");
    }
    const afterAccept = affairStatusAfterUserAcceptance("waiting_acceptance", "accept");
    if (afterAccept !== "closed") {
      throw new Error("用户验收后应 closed");
    }

    const memory = createSupervisionNotifyMemory();
    const blockedActions = runSupervisionTick(
      {
        affairId,
        affairTitle: "v1.3 e2e",
        affairStatus: "running",
        jobId: "adapter_job_blocked",
        jobStatus: "blocked",
        progressSummary: "blocked",
        attemptedSteps: ["probe"],
        blockedReason: "mock blocked",
        resumeCondition: "清除 mock 阻塞后 resume",
        observedAt: new Date().toISOString(),
      },
      memory,
    );
    const notify = blockedActions.find((a) => a.kind === "notify_blocked");
    if (!notify || notify.kind !== "notify_blocked") {
      throw new Error("监督 loop 未产出 blocked 通知");
    }
    rememberBlockedNotify(memory, affairId, notify.fingerprint);

    const adapterJobId = createJobId();
    const adapterJob = await adapter.createJob({
      jobId: adapterJobId,
      affairId,
      goal: "e2e adapter blocked scenario",
      workspaceHint: "F:/workspace/example",
      allowedPermissions: ["workspace.read"],
    });
    if (!adapterJob.ok) {
      throw new Error(`adapter create failed: ${adapterJob.message}`);
    }
    const runId = adapterJob.job.openclawRunId;
    if (!runId) {
      throw new Error("adapter job 缺少 openclawRunId");
    }
    mockRuntime.advance({
      runId,
      status: "blocked",
      patch: {
        summary: "mock blocked for e2e",
        blockedReason: "mock blocked",
        resumeCondition: "清除 mock 阻塞后 resume",
      },
    });
    const read = await adapter.readJob(adapterJobId);
    if (!read.ok) {
      throw new Error(`adapter read failed: ${read.message}`);
    }
    if (read.job.status !== "blocked") {
      throw new Error(`期望 adapter job blocked，实际=${read.job.status}`);
    }
    audit.append({
      kind: "job",
      summary: `adapter job ${read.job.jobId} 状态=${read.job.status}`,
      affairId,
      jobId: read.job.jobId,
      outcome: read.job.status,
    });

    const snapRes = await fetch(`${companion.baseUrl}/ui/snapshot`);
    const snapJson: unknown = await snapRes.json();
    const snap = validateControlPanelSnapshot(snapJson);
    if (!snap.ok) {
      throw new Error(`snapshot 校验失败: ${snap.error.message}`);
    }
    const current = (snapJson as { currentAffair?: { status?: string } | null }).currentAffair;
    if (!current || current.status !== "waiting_acceptance") {
      throw new Error(`期望 snapshot waiting_acceptance，实际=${current?.status}`);
    }

    process.stdout.write(
      `[e2e-v13] ok events=${events.length} adapterStatus=${read.job.status} audits=${audit.listRecent().length}\n`,
    );
  } finally {
    ws.close();
    await companion.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[e2e-v13] FAILED ${message}\n`);
  process.exitCode = 1;
});
