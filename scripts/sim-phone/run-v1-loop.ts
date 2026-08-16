/**
 * 模拟电话脚本：配对 → session → affair/job → 读取事件流。
 *
 * 职责：作为 phone 端最小客户端验证 mock companion 闭环。
 * 不拥有：真实电话 UI、OpenClaw、权限桌面确认。
 * 副作用：启动本机 mock companion、连接 WS、发协议消息、读 HTTP snapshot。
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
import { startMockCompanion } from "@lanxin-claw/mock-companion";

const PHONE_DEVICE_ID = "phone_sim_001";
const PHONE_DISPLAY_NAME = "模拟澜星电话";

/**
 * 等待 WebSocket open。
 *
 * @param ws WebSocket
 * @returns Promise
 */
function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("WebSocket open timeout"));
    }, 5_000);
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
 * 发送 envelope 并返回。
 *
 * @param ws WebSocket
 * @param envelope 协议消息
 */
function sendEnvelope(ws: WebSocket, envelope: ProtocolEnvelope): void {
  ws.send(JSON.stringify(envelope));
}

/**
 * 收集事件直到谓词满足或超时。
 *
 * @param events 可变事件列表
 * @param predicate 结束条件
 * @param timeoutMs 超时
 * @returns 满足条件的事件
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
  const companion = await startMockCompanion({
    port: 0,
    jobScenario: "completed",
    stepDelayMs: 30,
  });

  const wsUrl = companion.wsUrl;
  const baseUrl = companion.baseUrl;

  const events: ProtocolEnvelope[] = [];
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("message", (msg) => {
    const raw = JSON.parse(String(msg.data)) as unknown;
    if (raw && typeof raw === "object" && "ok" in (raw as object) && (raw as { ok?: boolean }).ok === false) {
      process.stderr.write(`[sim-phone] error frame ${JSON.stringify(raw)}\n`);
      return;
    }
    const validated = validateMessage(raw);
    if (!validated.ok) {
      process.stderr.write(`[sim-phone] invalid outbound ${validated.error.message}\n`);
      return;
    }
    events.push(validated.value);
    process.stdout.write(`[sim-phone] <- ${validated.value.type}\n`);
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
          title: "模拟电话：修好示例项目",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: ["由 scripts/sim-phone/run-v1-loop.ts 创建"],
          acceptanceCriteria: ["mock job.completed", "affair 进入 waiting_acceptance"],
          blockedReason: null,
          resumeCondition: null,
          currentJobId: null,
        },
      }),
    );
    await waitForEvent(events, (e) => e.type === "affair.update", 5_000);

    const jobCreateId = createMessageId();
    sendEnvelope(
      ws,
      createEnvelope({
        messageId: jobCreateId,
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "job.create",
        payload: {
          jobId,
          affairId,
          executor: "openclaw",
          status: "queued",
          goal: "Inspect mock workspace until done",
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
    const waiting = await waitForEvent(
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

    const snapRes = await fetch(`${baseUrl}/ui/snapshot`);
    const snapJson: unknown = await snapRes.json();
    const snap = validateControlPanelSnapshot(snapJson);
    if (!snap.ok) {
      throw new Error(`snapshot 校验失败: ${snap.error.message}`);
    }
    const current = (snapJson as { currentAffair?: { status?: string } | null }).currentAffair;
    if (!current || current.status !== "waiting_acceptance") {
      throw new Error(`期望 UI snapshot.currentAffair.status=waiting_acceptance，实际=${current?.status}`);
    }

    const eventsRes = await fetch(`${baseUrl}/events`);
    const eventsJson = (await eventsRes.json()) as { count: number };
    process.stdout.write(
      `[sim-phone] ok events=${events.length} httpEvents=${eventsJson.count} waiting=${(waiting.payload as { affairId: string }).affairId}\n`,
    );
  } finally {
    ws.close();
    await companion.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[sim-phone] FAILED ${message}\n`);
  process.exitCode = 1;
});
