/**
 * Mock OpenClaw worker：异步推进 job 状态。
 *
 * 职责：在 companion 接受 job 后模拟 progress / blocked / completed。
 * 不拥有：affair 用户验收关闭、真实命令执行、权限最终授予。
 * 副作用：定时更新 store 并通过 emit 推送协议事件；execution completed 只把 affair 推到 waiting_acceptance。
 */

import {
  canTransitionAffairStatus,
  canTransitionJobStatus,
  createEnvelope,
  type AffairPayload,
  type JobPayload,
} from "@lanxin-claw/protocol";
import type { MockCompanionConfig } from "../config.js";
import type { MemoryStore } from "../store/memory-store.js";
import type { EmitEnvelope } from "../pairing/handle-pairing.js";

/**
 * 延迟指定毫秒。
 *
 * @param ms 毫秒
 * @returns Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 向 phone 发出 job 状态 envelope。
 *
 * @param config 配置
 * @param phoneDeviceId 电话设备 id
 * @param type message type
 * @param job job 载荷
 * @param correlationId 关联创建请求
 * @param emit 出站回调
 */
function emitJob(
  config: MockCompanionConfig,
  phoneDeviceId: string,
  type: string,
  job: JobPayload,
  correlationId: string,
  emit: EmitEnvelope,
): void {
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: phoneDeviceId },
      type,
      correlationId,
      payload: job,
    }),
  );
}

/**
 * 发出 affair.update。
 *
 * @param config 配置
 * @param phoneDeviceId 电话设备 id
 * @param affair 事务载荷
 * @param correlationId 关联 id
 * @param emit 出站回调
 */
function emitAffairUpdate(
  config: MockCompanionConfig,
  phoneDeviceId: string,
  affair: AffairPayload,
  correlationId: string,
  emit: EmitEnvelope,
): void {
  emit(
    createEnvelope({
      source: { kind: "companion", deviceId: config.desktopDeviceId },
      target: { kind: "phone", deviceId: phoneDeviceId },
      type: "affair.update",
      correlationId,
      payload: affair,
    }),
  );
}

/**
 * 安全迁移 affair 状态；非法迁移时保持原状。
 *
 * @param affair 当前事务
 * @param to 目标状态
 * @returns 更新后的事务
 */
function transitionAffair(affair: AffairPayload, to: AffairPayload["status"]): AffairPayload {
  if (!canTransitionAffairStatus(affair.status, to)) {
    return affair;
  }
  return { ...affair, status: to };
}

/**
 * 安全迁移 job 状态。
 *
 * @param job 当前 job
 * @param to 目标状态
 * @returns 更新后的 job
 */
function transitionJob(job: JobPayload, to: JobPayload["status"]): JobPayload {
  if (!canTransitionJobStatus(job.status, to)) {
    return job;
  }
  return { ...job, status: to };
}

/**
 * exploration job 只回传探测结果，不推进 affair 生命周期。
 *
 * @param job job 载荷
 * @returns 是否为探索 job
 */
function isExplorationJob(job: JobPayload): boolean {
  return job.purpose === "exploration";
}

/**
 * 启动 mock worker 异步状态机（fire-and-forget）。
 *
 * @param store 内存 store
 * @param config 配置
 * @param jobId job id
 * @param phoneDeviceId 电话设备 id
 * @param correlationId 关联 job.create
 * @param emit 出站回调
 */
export function startMockWorker(
  store: MemoryStore,
  config: MockCompanionConfig,
  jobId: string,
  phoneDeviceId: string,
  correlationId: string,
  emit: EmitEnvelope,
): void {
  void runMockWorker(store, config, jobId, phoneDeviceId, correlationId, emit);
}

/**
 * mock worker 主流程。
 *
 * @param store 内存 store
 * @param config 配置
 * @param jobId job id
 * @param phoneDeviceId 电话设备 id
 * @param correlationId 关联 id
 * @param emit 出站回调
 */
async function runMockWorker(
  store: MemoryStore,
  config: MockCompanionConfig,
  jobId: string,
  phoneDeviceId: string,
  correlationId: string,
  emit: EmitEnvelope,
): Promise<void> {
  await sleep(config.stepDelayMs);
  const job0 = store.jobs.get(jobId);
  if (!job0) {
    return;
  }
  const running: JobPayload = {
    ...transitionJob(job0, "running"),
    progressSummary: "mock worker 已开始检查工作区",
  };
  store.jobs.set(jobId, running);
  const affair0 = store.affairs.get(running.affairId);
  if (affair0 && !isExplorationJob(running)) {
    const nextAffair = transitionAffair(
      { ...affair0, currentJobId: jobId },
      "running",
    );
    store.affairs.set(nextAffair.affairId, nextAffair);
  }
  emitJob(config, phoneDeviceId, "job.progress", running, correlationId, emit);

  await sleep(config.stepDelayMs);
  if (config.jobScenario === "blocked") {
    await finishBlocked(store, config, jobId, phoneDeviceId, correlationId, emit);
    return;
  }
  await finishCompleted(store, config, jobId, phoneDeviceId, correlationId, emit);
}

/**
 * 结束为 blocked，并记录 lastError。
 *
 * @param store 内存 store
 * @param config 配置
 * @param jobId job id
 * @param phoneDeviceId 电话设备 id
 * @param correlationId 关联 id
 * @param emit 出站回调
 */
async function finishBlocked(
  store: MemoryStore,
  config: MockCompanionConfig,
  jobId: string,
  phoneDeviceId: string,
  correlationId: string,
  emit: EmitEnvelope,
): Promise<void> {
  const job = store.jobs.get(jobId);
  if (!job) {
    return;
  }
  const blockedReason = "mock：无法访问外部 registry，需要用户恢复网络后 resume";
  const resumeCondition = "网络可达后发送 affair.resume / 重新 job.create";
  const blocked: JobPayload = {
    ...transitionJob(job, "blocked"),
    progressSummary: "依赖安装尝试失败",
    blockedReason,
    resumeCondition,
  };
  store.jobs.set(jobId, blocked);
  const affair = store.affairs.get(blocked.affairId);
  if (affair && !isExplorationJob(blocked)) {
    const next = transitionAffair(
      {
        ...affair,
        blockedReason,
        resumeCondition,
        currentJobId: jobId,
      },
      "blocked",
    );
    store.affairs.set(next.affairId, next);
    emitAffairUpdate(config, phoneDeviceId, next, correlationId, emit);
  }
  store.lastError = {
    occurredAt: new Date().toISOString(),
    code: "job.blocked",
    severity: "error",
    message: "无法访问外部 registry（mock）",
    affairId: blocked.affairId,
    jobId,
    retryable: true,
  };
  emitJob(config, phoneDeviceId, "job.blocked", blocked, correlationId, emit);
}

/**
 * 结束为 completed；execution affair 进入 waiting_acceptance，exploration 只回传 job.completed。
 *
 * @param store 内存 store
 * @param config 配置
 * @param jobId job id
 * @param phoneDeviceId 电话设备 id
 * @param correlationId 关联 id
 * @param emit 出站回调
 */
async function finishCompleted(
  store: MemoryStore,
  config: MockCompanionConfig,
  jobId: string,
  phoneDeviceId: string,
  correlationId: string,
  emit: EmitEnvelope,
): Promise<void> {
  const job = store.jobs.get(jobId);
  if (!job) {
    return;
  }
  const completed: JobPayload = {
    ...transitionJob(job, "completed"),
    progressSummary: isExplorationJob(job)
      ? "mock worker 已完成只读探索"
      : "mock worker 认为目标已完成，等待用户验收",
    blockedReason: null,
    resumeCondition: null,
  };
  store.jobs.set(jobId, completed);
  emitJob(config, phoneDeviceId, "job.completed", completed, correlationId, emit);

  const affair = store.affairs.get(completed.affairId);
  if (!affair || isExplorationJob(completed)) {
    return;
  }
  const waiting = transitionAffair(
    {
      ...affair,
      currentJobId: jobId,
      blockedReason: null,
      resumeCondition: null,
    },
    "waiting_acceptance",
  );
  store.affairs.set(waiting.affairId, waiting);
  emitAffairUpdate(config, phoneDeviceId, waiting, correlationId, emit);
}
