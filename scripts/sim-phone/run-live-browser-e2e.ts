/**
 * 对正在运行的真 companion 发查资料类 job（全自治 E2E）。
 *
 * 前置：LANXIN_PROTOCOL_PORT=18765 LANXIN_E2E_AUTO_APPROVE=1 npm run start:companion
 * 运行：npx tsx scripts/sim-phone/run-live-browser-e2e.ts
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
import { createSessionAuthProof } from "../../apps/companion/src/credentials/auth-proof.js";

const PHONE_DEVICE_ID =
  process.env.LANXIN_E2E_PHONE_ID?.trim() || `phone_e2e_browser_${Date.now().toString(36)}`;
const DESKTOP_DEVICE_ID = process.env.LANXIN_DESKTOP_DEVICE_ID?.trim() || "lanxin-desktop";
const WS_URL = process.env.LANXIN_E2E_WS_URL?.trim() || "ws://127.0.0.1:18765/ws";
const GOAL =
  process.env.LANXIN_E2E_GOAL?.trim() ||
  "打开浏览器查询 BNB 当前价格，优先使用 browser，不要调用 web_search";
const JOB_WAIT_MS = Number(process.env.LANXIN_E2E_TIMEOUT_MS ?? 180_000);

async function main(): Promise<void> {
  const phone = new PhoneClient(WS_URL);
  await phone.open();
  process.stdout.write(`[live-e2e] connected ${WS_URL}\n`);

  const pairingId = `pair_e2e_${Date.now().toString(36)}`;
  phone.send(
    createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "pairing.request",
      payload: {
        pairingId,
        phoneDeviceId: PHONE_DEVICE_ID,
        phoneDisplayName: "E2E 模拟电话",
        protocolVersion: PROTOCOL_VERSION,
        capabilities: ["affair", "job", "chat", "permission"],
      },
    }),
  );
  const challenge = await phone.nextEnvelope("pairing.challenge", 60_000);
  phone.send(
    createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "pairing.confirmed",
      correlationId: challenge.messageId,
      payload: {
        pairingId,
        challengeResponse: String((challenge.payload as { challenge: string }).challenge),
        phoneConfirmedAt: new Date().toISOString(),
      },
    }),
  );
  await phone.nextJson("pairing.confirmed ack", 30_000);
  await phone.nextEnvelope("pairing.desktop_approved", 90_000);
  const completed = await phone.nextEnvelope("pairing.completed", 60_000);
  const pairingSecret = String(
    (completed.payload as { pairingSecret?: string }).pairingSecret ?? "",
  ).trim();
  if (!pairingSecret) {
    throw new Error("pairing.completed 缺少 pairingSecret");
  }
  process.stdout.write(`[live-e2e] pairing ok ${pairingId}\n`);

  const sessionId = createSessionId();
  phone.send(
    createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "session.open",
      payload: {
        sessionId,
        phoneDeviceId: PHONE_DEVICE_ID,
        desktopDeviceId: DESKTOP_DEVICE_ID,
        authProof: createSessionAuthProof(pairingSecret, sessionId),
        protocolVersion: PROTOCOL_VERSION,
      },
    }),
  );
  await phone.nextEnvelope("session.accepted", 60_000);
  phone.startHeartbeat(sessionId);
  process.stdout.write(`[live-e2e] session ok\n`);

  const affairId = createAffairId();
  const jobId = createJobId();
  phone.send(
    createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "affair.create",
      payload: {
        affairId,
        title: "E2E 查资料",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: ["能回报价格或明确阻塞原因"],
        currentJobId: null,
      },
    }),
  );
  await phone.nextJson("affair.create ack", 30_000);

  phone.send(
    createEnvelope({
      source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
      target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
      type: "job.create",
      payload: {
        jobId,
        affairId,
        executor: "openclaw",
        status: "queued",
        goal: GOAL,
        workspaceHint: null,
        allowedPermissions: ["network.access"],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      },
    }),
  );

  await phone.nextEnvelope("job.needs_permission", 90_000);
  const permReq = await phone.nextEnvelope("permission.request", 60_000);
  const perms =
    (permReq.payload as { requestedPermissions?: string[] }).requestedPermissions ?? [];
  process.stdout.write(`[live-e2e] perms=${JSON.stringify(perms)}\n`);
  if (!perms.includes("desktop.control") || !perms.includes("network.access")) {
    throw new Error(`补权失败：${JSON.stringify(perms)}`);
  }
  await phone.nextJson("job.create ack", 30_000);
  await phone.nextEnvelope("job.accepted", 180_000);
  process.stdout.write(`[live-e2e] job.accepted jobId=${jobId}\n`);

  const started = Date.now();
  let sawBrowserHint = false;
  let lastStatus = "running";
  while (Date.now() - started < JOB_WAIT_MS) {
    let msg: unknown;
    try {
      msg = await phone.nextAny(20_000);
    } catch {
      process.stdout.write(`[live-e2e] waiting… elapsed=${Date.now() - started}ms\n`);
      continue;
    }
    if (!msg || typeof msg !== "object") {
      continue;
    }
    const env = msg as ProtocolEnvelope;
    if (!env.type) {
      continue;
    }
    const payload = (env.payload ?? {}) as Record<string, unknown>;
    const blob = JSON.stringify(payload);
    if (/browser/i.test(blob)) {
      sawBrowserHint = true;
    }
    if (env.type === "job.progress" || env.type === "job.completed" || env.type === "job.failed") {
      lastStatus = String(payload.status ?? env.type);
      process.stdout.write(
        `[live-e2e] ${env.type} status=${payload.status ?? ""} reason=${payload.statusReasonCode ?? ""} summary=${String(payload.progressSummary ?? payload.blockedReason ?? "").slice(0, 180)}\n`,
      );
    }
    if (env.type === "job.completed") {
      if (!sawBrowserHint) {
        throw new Error("job.completed 但未见 browser 工具证据");
      }
      process.stdout.write(`[live-e2e] OK completed browserHint=${sawBrowserHint}\n`);
      phone.close();
      return;
    }
    if (env.type === "job.failed") {
      const code = String(payload.statusReasonCode ?? "");
      if (code === "openclaw.tool_failed" && /web_search/i.test(blob)) {
        throw new Error(`web_search 秒杀: ${blob.slice(0, 400)}`);
      }
      throw new Error(
        `job.failed code=${code} browserHint=${sawBrowserHint} summary=${String(payload.progressSummary ?? payload.blockedReason ?? "").slice(0, 240)}`,
      );
    }
  }

  throw new Error(
    `job 超时 lastStatus=${lastStatus} browserHint=${sawBrowserHint}`,
  );
}

class PhoneClient {
  readonly #socket: WebSocket;
  readonly #queue: unknown[] = [];
  readonly #waiters: Array<(value: unknown) => void> = [];
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #sessionId: string | null = null;

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

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket.once("open", resolve);
      this.#socket.once("error", reject);
    });
  }

  send(envelope: ProtocolEnvelope): void {
    this.#socket.send(JSON.stringify(envelope));
  }

  /**
   * 启动 session 心跳，避免 companion 15s 内无 lastSeen 清掉 authenticated socket，
   * 导致后续 job.completed 被跳过。
   *
   * @param sessionId 当前会话
   * @param intervalMs 心跳间隔
   */
  startHeartbeat(sessionId: string, intervalMs = 4_000): void {
    this.#sessionId = sessionId;
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
    }
    const beat = (): void => {
      if (!this.#sessionId || this.#socket.readyState !== WebSocket.OPEN) {
        return;
      }
      this.send(
        createEnvelope({
          source: { kind: "phone", deviceId: PHONE_DEVICE_ID },
          target: { kind: "companion", deviceId: DESKTOP_DEVICE_ID },
          type: "session.heartbeat",
          payload: {
            sessionId: this.#sessionId,
            sentAt: new Date().toISOString(),
          },
        }),
      );
    };
    beat();
    this.#heartbeatTimer = setInterval(beat, intervalMs);
  }

  close(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    this.#socket.terminate();
  }

  async nextJson(label: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const value = await this.#next(label, timeoutMs);
    return value as Record<string, unknown>;
  }

  async nextEnvelope(type: string, timeoutMs: number): Promise<ProtocolEnvelope> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const value = (await this.#next(
          type,
          Math.min(5_000, Math.max(1, deadline - Date.now())),
        )) as ProtocolEnvelope;
        if (value?.type === type) {
          return value;
        }
      } catch {
        // 空窗超时不算失败；继续等到总 deadline
      }
    }
    throw new Error(`等待 ${type} 超时`);
  }

  async nextAny(timeoutMs: number): Promise<unknown> {
    return this.#next("any", timeoutMs);
  }

  #next(label: string, timeoutMs: number): Promise<unknown> {
    if (this.#queue.length > 0) {
      return Promise.resolve(this.#queue.shift());
    }
    return new Promise((resolve, reject) => {
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
      }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[live-e2e] FAILED ${message}\n`);
  process.exitCode = 1;
});
