/**
 * Mock companion 事件流 contract：pairing → job → progress/blocked/completed；
 * worker completed 不得映射 affair closed。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
import { startMockCompanion } from "../../src/server.js";

const PHONE_DEVICE_ID = "phone_contract_001";
const PHONE_DISPLAY_NAME = "Contract Phone";

/**
 * 等待 WebSocket open。
 *
 * @param ws WebSocket
 * @returns Promise
 */
function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws open timeout")), 5_000);
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
 * 等待事件流中满足谓词的消息。
 *
 * @param events 事件列表
 * @param predicate 谓词
 * @param timeoutMs 超时
 * @returns 匹配事件
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
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`waitForEvent timeout ${timeoutMs}ms`);
}

/**
 * 完成配对与 session，返回桌面设备 id。
 *
 * @param ws WebSocket
 * @param events 事件收集器
 * @param desktopId companion 设备 id
 * @returns authProof
 */
async function pairAndOpenSession(
  ws: WebSocket,
  events: ProtocolEnvelope[],
  desktopId: string,
): Promise<string> {
  const pairingId = createPairingId();
  ws.send(
    JSON.stringify(
      createEnvelope({
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "pairing.request",
        payload: {
          pairingId,
          phoneDeviceId: PHONE_DEVICE_ID,
          phoneDisplayName: PHONE_DISPLAY_NAME,
          protocolVersion: PROTOCOL_VERSION,
          capabilities: ["affair", "job"],
        },
      }),
    ),
  );
  const challenge = await waitForEvent(events, (e) => e.type === "pairing.challenge", 5_000);
  const challengeText = (challenge.payload as { challenge: string }).challenge;
  ws.send(
    JSON.stringify(
      createEnvelope({
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "pairing.confirmed",
        payload: {
          pairingId,
          challengeResponse: challengeText,
          phoneConfirmedAt: new Date().toISOString(),
        },
      }),
    ),
  );
  await waitForEvent(events, (e) => e.type === "pairing.completed", 5_000);
  const authProof = `mock-paired:${pairingId}`;
  ws.send(
    JSON.stringify(
      createEnvelope({
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "session.open",
        payload: {
          sessionId: createSessionId(),
          phoneDeviceId: PHONE_DEVICE_ID,
          desktopDeviceId: desktopId,
          authProof,
          protocolVersion: PROTOCOL_VERSION,
        },
      }),
    ),
  );
  await waitForEvent(events, (e) => e.type === "session.accepted", 5_000);
  return authProof;
}

/**
 * 创建 affair，等待 update 后再创建 job。
 *
 * @param ws WebSocket
 * @param events 事件收集器
 * @param desktopId 桌面 id
 * @param affairId 事务 id
 * @param jobId job id
 */
async function createAffairAndJob(
  ws: WebSocket,
  events: ProtocolEnvelope[],
  desktopId: string,
  affairId: string,
  jobId: string,
): Promise<void> {
  ws.send(
    JSON.stringify(
      createEnvelope({
        messageId: createMessageId(),
        source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
        target: { kind: "companion", deviceId: desktopId },
        type: "affair.create",
        payload: {
          affairId,
          title: "contract 事件流事务",
          ownerAgent: "zhang-boss",
          status: "ready",
          context: ["event-stream test"],
          acceptanceCriteria: ["waiting_acceptance"],
          blockedReason: null,
          resumeCondition: null,
          currentJobId: null,
        },
      }),
    ),
  );
  await waitForEvent(
    events,
    (e) =>
      e.type === "affair.update" && (e.payload as { affairId?: string }).affairId === affairId,
    5_000,
  );
  ws.send(
    JSON.stringify(
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
          goal: "contract mock job",
          workspaceHint: null,
          allowedPermissions: ["workspace.read"],
          progressSummary: "",
          blockedReason: null,
          resumeCondition: null,
          permissionRequestId: null,
        },
      }),
    ),
  );
}

/**
 * 连接 companion 并收集出站 envelope。
 *
 * @param wsUrl WebSocket URL
 * @returns events 与 ws
 */
async function connectEvents(wsUrl: string): Promise<{
  events: ProtocolEnvelope[];
  ws: WebSocket;
}> {
  const events: ProtocolEnvelope[] = [];
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("message", (msg) => {
    const raw = JSON.parse(String(msg.data)) as unknown;
    if (raw && typeof raw === "object" && "ok" in (raw as object) && (raw as { ok?: boolean }).ok === false) {
      return;
    }
    const validated = validateMessage(raw);
    if (validated.ok) {
      events.push(validated.value);
    }
  });
  await waitOpen(ws);
  return { events, ws };
}

describe("mock companion 事件流", () => {
  it("completed 场景：progress → completed → waiting_acceptance，绝不 closed", async () => {
    const companion = await startMockCompanion({
      port: 0,
      jobScenario: "completed",
      stepDelayMs: 20,
    });
    const { events, ws } = await connectEvents(companion.wsUrl);
    try {
      const desktopId = companion.config.desktopDeviceId;
      await pairAndOpenSession(ws, events, desktopId);
      const affairId = createAffairId();
      const jobId = createJobId();
      await createAffairAndJob(ws, events, desktopId, affairId, jobId);

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

      const closed = events.some(
        (e) =>
          e.type === "affair.update" && (e.payload as { status?: string }).status === "closed",
      );
      assert.equal(closed, false, "worker completed 不得映射为 affair closed");

      const snapRes = await fetch(`${companion.baseUrl}/ui/snapshot`);
      const snapJson: unknown = await snapRes.json();
      const snap = validateControlPanelSnapshot(snapJson);
      assert.equal(snap.ok, true, snap.ok ? "" : snap.error.message);
      const current = (snapJson as { currentAffair?: { status?: string } | null }).currentAffair;
      assert.equal(current?.status, "waiting_acceptance");

      const eventsRes = await fetch(`${companion.baseUrl}/events`);
      const body = (await eventsRes.json()) as { count: number };
      assert.ok(body.count >= 4);
    } finally {
      ws.close();
      await companion.close();
    }
  });

  it("blocked 场景：发出 job.blocked 与 affair.blocked，并写入 lastError", async () => {
    const companion = await startMockCompanion({
      port: 0,
      jobScenario: "blocked",
      stepDelayMs: 20,
    });
    const { events, ws } = await connectEvents(companion.wsUrl);
    try {
      const desktopId = companion.config.desktopDeviceId;
      await pairAndOpenSession(ws, events, desktopId);
      await createAffairAndJob(ws, events, desktopId, createAffairId(), createJobId());

      await waitForEvent(events, (e) => e.type === "job.progress", 5_000);
      const blocked = await waitForEvent(events, (e) => e.type === "job.blocked", 5_000);
      const payload = blocked.payload as {
        blockedReason?: string | null;
        resumeCondition?: string | null;
      };
      assert.ok(payload.blockedReason);
      assert.ok(payload.resumeCondition);

      await waitForEvent(
        events,
        (e) =>
          e.type === "affair.update" && (e.payload as { status?: string }).status === "blocked",
        5_000,
      );

      const diagRes = await fetch(`${companion.baseUrl}/ui/diagnostic-report`);
      const diag = (await diagRes.json()) as {
        lastError?: { code?: string } | null;
        overallStatus?: string;
      };
      assert.equal(diag.lastError?.code, "job.blocked");
      assert.equal(diag.overallStatus, "warn");
    } finally {
      ws.close();
      await companion.close();
    }
  });
});
