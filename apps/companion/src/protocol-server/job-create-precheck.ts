/**
 * job.create 入站门闩：affair 存在、jobId 幂等、seenMessages、OpenClaw 能力预检。
 *
 * 职责：在入队 permission 前校验 job.create 语义。
 * 不拥有：WS、gate 入队、出站广播。
 * 副作用：经 backend 写入 seenMessages（成功路径）。
 */

import type { JobPayload, ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { CompanionBackendRuntime } from "../backend/runtime.js";
import type { PermissionGate } from "../permissions/gate/permission-gate.js";
import {
  classifyJobWebCapabilityNeed,
  openClawCapabilitySatisfies,
  type OpenClawToolCapabilitySummary,
} from "../gateway-runtime/openclaw-capability.js";

/** 并发 job.create 互斥（进程内） */
const jobCreateClaims = new Set<string>();

/** job.create 预检结果 */
export type JobCreatePrecheckResult =
  | { ok: true; duplicate: false }
  | { ok: true; duplicate: true }
  | { ok: false; code: string; message: string; retryable: false; nextStep?: string };

/** 能力预检可选依赖 */
export interface JobCreateCapabilityPort {
  /** 读取 OpenClaw 工具能力；可空表示跳过能力门（测试） */
  getOpenClawToolCapabilities?: () => OpenClawToolCapabilitySummary;
}

/**
 * 校验 affair 存在、jobId 幂等与 payload 冲突；联网意图校验 OpenClaw 能力。
 *
 * @param backend 后端 runtime
 * @param envelope 入站 job.create 消息
 * @param capabilityPort 可选能力探针
 * @returns 预检结果
 */
export function precheckJobCreate(
  backend: CompanionBackendRuntime,
  envelope: ProtocolEnvelope,
  capabilityPort?: JobCreateCapabilityPort | null,
): JobCreatePrecheckResult {
  const state = backend.getState();
  if (state.seenMessages.has(envelope.messageId)) {
    return { ok: true, duplicate: true };
  }
  const payload = envelope.payload as unknown as JobPayload;
  if (!state.affairs.has(payload.affairId)) {
    return {
      ok: false,
      code: "affair_not_found",
      message: `找不到 affairId=${payload.affairId}`,
      retryable: false,
    };
  }
  if (backend.getAffairActions().isClosing(payload.affairId) ||
      ["closed", "canceled"].includes(state.affairs.get(payload.affairId)?.status ?? "")) {
    return { ok: false, code: "affair_closing", message: "事务正在关闭，不能再创建 job", retryable: false };
  }
  const existing = state.jobs.get(payload.jobId);
  if (!existing) {
    const conflict = precheckCurrentExecution(backend, payload);
    if (conflict) return conflict;
    const capabilityError = precheckOpenClawCapability(payload, capabilityPort);
    if (capabilityError) {
      return capabilityError;
    }
    return { ok: true, duplicate: false };
  }
  if (!isEquivalentJobCreate(existing, payload)) {
    return {
      ok: false,
      code: "job_id_conflict",
      message: "jobId 已存在但 affairId/goal/purpose/allowedPermissions/taskIntentId 不一致",
      retryable: false,
    };
  }
  return { ok: true, duplicate: true };
}

function precheckCurrentExecution(backend: CompanionBackendRuntime, payload: JobPayload): JobCreatePrecheckResult | null {
  if (payload.purpose === "exploration") return null;
  const state = backend.getState();
  const currentId = state.affairs.get(payload.affairId)?.currentJobId;
  const current = currentId ? state.jobs.get(currentId) : null;
  if (!current || current.jobId === payload.jobId || current.purpose === "exploration") return null;
  return ["completed", "failed", "canceled"].includes(current.status) ? null
    : { ok: false, code: "current_job_not_stopped", message: "当前执行任务尚未停止，不能被新任务替换", retryable: false };
}

function precheckOpenClawCapability(
  payload: JobPayload,
  capabilityPort?: JobCreateCapabilityPort | null,
): JobCreatePrecheckResult | null {
  if (!capabilityPort?.getOpenClawToolCapabilities) {
    return null;
  }
  // 探索类只读任务不拦；避免误杀本地列目录。
  if (payload.purpose === "exploration") {
    return null;
  }
  const need = classifyJobWebCapabilityNeed({
    goal: payload.goal,
    allowedPermissions: payload.allowedPermissions ?? [],
  });
  if (!need) {
    return null;
  }
  const summary = capabilityPort.getOpenClawToolCapabilities();
  if (openClawCapabilitySatisfies(summary, need)) {
    return null;
  }
  return {
    ok: false,
    code: "capability_missing",
    message:
      "OpenClaw 浏览器能力未就绪，无法创建联网/浏览器执行 job。请确认 companion 已启动自托管 Gateway（安装档默认开启 browser）。",
    retryable: false,
    nextStep: "configure_openclaw_browser",
  };
}

/**
 * 记录 job.create messageId 已处理。
 *
 * @param backend 后端 runtime
 * @param envelope 入站 job.create 消息
 */
export function recordJobCreateAccepted(
  backend: CompanionBackendRuntime,
  envelope: ProtocolEnvelope,
): void {
  backend.recordInboundMessageId(envelope.messageId);
}

/**
 * 尝试占用 jobId 创建槽（防并发双入队）。
 *
 * @param jobId job id
 * @param backend 后端
 * @param gate 权限 gate
 * @returns 是否成功占用
 */
export function tryClaimJobCreate(
  jobId: string,
  backend: CompanionBackendRuntime,
  gate: PermissionGate,
): boolean {
  if (jobCreateClaims.has(jobId)) {
    return false;
  }
  if (gate.hasPendingForJob(jobId)) {
    return false;
  }
  if (backend.getState().jobs.has(jobId)) {
    return false;
  }
  jobCreateClaims.add(jobId);
  return true;
}

/**
 * 释放 job.create 占用（成功或失败路径均需调用）。
 *
 * @param jobId job id
 */
export function releaseJobCreateClaim(jobId: string): void {
  jobCreateClaims.delete(jobId);
}

/**
 * 两 job.create payload 是否语义等价（幂等重试用）。
 *
 * @param existing 已存 job
 * @param incoming 入站 job.create
 * @returns 是否等价
 */
function isEquivalentJobCreate(existing: JobPayload, incoming: JobPayload): boolean {
  return (
    existing.affairId === incoming.affairId &&
    existing.goal === incoming.goal &&
    normalizePurpose(existing.purpose) === normalizePurpose(incoming.purpose) &&
    taskIntentCompatible(existing, incoming) &&
    normalizePermissions(existing.allowedPermissions) ===
      normalizePermissions(incoming.allowedPermissions ?? [])
  );
}

function taskIntentCompatible(existing: JobPayload, incoming: JobPayload): boolean {
  if (!existing.taskIntentId || !incoming.taskIntentId) {
    return true;
  }
  return existing.taskIntentId === incoming.taskIntentId;
}

/**
 * @param purpose job 用途
 * @returns 归一化用途
 */
function normalizePurpose(purpose: JobPayload["purpose"]): "execution" | "exploration" {
  return purpose === "exploration" ? "exploration" : "execution";
}

/**
 * @param permissions 权限列表
 * @returns 排序后逗号串
 */
function normalizePermissions(permissions: readonly string[]): string {
  return [...permissions].sort().join(",");
}
