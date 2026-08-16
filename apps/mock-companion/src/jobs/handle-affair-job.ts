/**
 * Affair / job 入站处理。
 *
 * 职责：校验会话后接受 affair.create / job.create，并启动 mock worker。
 * 不拥有：用户验收关闭事务、真实 OpenClaw 执行。
 * 副作用：更新 store；emit 协议事件；异步调度 mock worker。
 */

import {
  canTransitionAffairStatus,
  createEnvelope,
  createProtocolError,
  type AffairPayload,
  type JobPayload,
  type ProtocolEnvelope,
  type ProtocolError,
} from "@lanxin-claw/protocol";
import type { MockCompanionConfig } from "../config.js";
import type { EmitEnvelope } from "../pairing/handle-pairing.js";
import type { MemoryStore } from "../store/memory-store.js";
import { startMockWorker } from "./mock-worker.js";

/**
 * 处理结果。
 */
export type AffairJobHandleResult = { ok: true } | { ok: false; error: ProtocolError };

/**
 * 要求已建立 session。
 *
 * @param store 内存 store
 * @returns 错误或 null
 */
function requireSession(store: MemoryStore): ProtocolError | null {
  if (!store.session) {
    return createProtocolError("session_required", "需要先完成 pairing 与 session.open", false);
  }
  return null;
}

/**
 * 处理 affair.create。
 *
 * @param store 内存 store
 * @param config 配置
 * @param inbound 入站 envelope
 * @param emit 出站回调
 * @returns 处理结果
 */
export function handleAffairCreate(
  store: MemoryStore,
  config: MockCompanionConfig,
  inbound: ProtocolEnvelope,
  emit: EmitEnvelope,
): AffairJobHandleResult {
  const sessionErr = requireSession(store);
  if (sessionErr) {
    return { ok: false, error: sessionErr };
  }
  const payload = inbound.payload as unknown as AffairPayload;
  if (store.affairs.has(payload.affairId)) {
    return {
      ok: false,
      error: createProtocolError("affair_exists", "affairId 已存在", false, {
        affairId: payload.affairId,
      }),
    };
  }
  store.affairs.set(payload.affairId, { ...payload });
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: store.session!.phoneDeviceId },
      type: "affair.update",
      correlationId: inbound.messageId,
      payload: store.affairs.get(payload.affairId)!,
    }),
  );
  return { ok: true };
}

/**
 * 处理 job.create：接受后启动 mock worker。
 *
 * @param store 内存 store
 * @param config 配置
 * @param inbound 入站 envelope
 * @param emit 出站回调
 * @returns 处理结果
 */
export function handleJobCreate(
  store: MemoryStore,
  config: MockCompanionConfig,
  inbound: ProtocolEnvelope,
  emit: EmitEnvelope,
): AffairJobHandleResult {
  const sessionErr = requireSession(store);
  if (sessionErr) {
    return { ok: false, error: sessionErr };
  }
  const payload = inbound.payload as unknown as JobPayload;
  const affair = store.affairs.get(payload.affairId);
  if (!affair) {
    return {
      ok: false,
      error: createProtocolError("affair_not_found", "找不到对应 affair", false, {
        affairId: payload.affairId,
      }),
    };
  }
  if (store.jobs.has(payload.jobId)) {
    return {
      ok: false,
      error: createProtocolError("job_exists", "jobId 已存在（请考虑幂等重试）", false, {
        jobId: payload.jobId,
      }),
    };
  }

  const queued: JobPayload = {
    ...payload,
    status: "queued",
    executor: "openclaw",
  };
  store.jobs.set(queued.jobId, queued);

  let nextAffair = { ...affair, currentJobId: queued.jobId };
  if (canTransitionAffairStatus(nextAffair.status, "delegated")) {
    nextAffair = { ...nextAffair, status: "delegated" };
  }
  store.affairs.set(nextAffair.affairId, nextAffair);

  const phoneDeviceId = store.session!.phoneDeviceId;
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: phoneDeviceId },
      type: "job.accepted",
      correlationId: inbound.messageId,
      payload: queued,
    }),
  );
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: phoneDeviceId },
      type: "affair.update",
      correlationId: inbound.messageId,
      payload: nextAffair,
    }),
  );

  startMockWorker(store, config, queued.jobId, phoneDeviceId, inbound.messageId, emit);
  return { ok: true };
}
