/**
 * 事务关闭权威：持久化意图、串行执行、持久化业务结果后才通知。
 * 不拥有 runtime 取消实现或网络连接；外部已生效的取消不回滚。
 */
import { createEnvelope, validateAffairClosePayload, type AffairActionResult } from "@lanxin-claw/protocol";
import type { PermissionGate } from "../../permissions/gate/permission-gate.js";
import type { CompanionBackendState } from "../../state/types.js";
import { AffairOperationQueue } from "./serial.js";
import { isTerminalJob, precheckAffairClose } from "./guards/precheck.js";
import type { AffairActionOutcome, AffairActionPorts, AffairActionRecord, AffairActionRequest } from "./types.js";

interface CoordinatorDeps {
  state: CompanionBackendState;
  gate: PermissionGate;
  persist: () => void;
  publish: () => void;
}

/** UI/WS/委派共享的事务操作协调器。 */
export class AffairActionCoordinator {
  readonly operations = new AffairOperationQueue();
  private readonly running = new Map<string, Promise<AffairActionOutcome>>();

  constructor(private readonly deps: CoordinatorDeps) {}

  /** pending 关闭请求是围栏；重启从镜像恢复后仍有效。 */
  isClosing(affairId: string): boolean {
    return [...this.deps.state.affairActions.values()].some((record) =>
      record.command.affairId === affairId && record.phase === "pending");
  }

  /** 查找本地 UI 尚待确认的同一操作，重试沿用原键。 */
  findPending(affairId: string, actorId?: string): AffairActionRecord | undefined {
    return [...this.deps.state.affairActions.values()].find((record) =>
      record.command.affairId === affairId && (!actorId || record.actorId === actorId) && record.phase === "pending");
  }

  /** 重启后继续已持久化的用户意图；每条沿用原请求键，不创建新关闭动作。 */
  async recoverPending(ports: AffairActionPorts): Promise<AffairActionOutcome[]> {
    const pending = [...this.deps.state.affairActions.values()].filter((record) => record.phase === "pending");
    const outcomes: AffairActionOutcome[] = [];
    for (const record of pending) outcomes.push(await this.execute(record, ports));
    return outcomes;
  }

  /** 先持久化请求；在事务队列内重新校验及执行，重复请求返回原结果。 */
  execute(request: AffairActionRequest, ports: AffairActionPorts): Promise<AffairActionOutcome> {
    const valid = validateAffairClosePayload(request.command);
    if (!valid.ok) return Promise.resolve({ ok: false, error: valid.error });
    const key = JSON.stringify([request.actorId, request.requestId]);
    const existing = this.deps.state.affairActions.get(key);
    if (existing && this.fingerprint(existing.command) !== this.fingerprint(request.command)) {
      return Promise.resolve(this.failure("affair_action_id_conflict", "原请求 ID 不得改变关闭内容", false));
    }
    if (existing?.outcome && existing.phase !== "pending") {
      const outcome = structuredClone(existing.outcome);
      return Promise.resolve(outcome.ok ? { ...outcome, duplicate: true } : outcome);
    }
    const active = this.running.get(key);
    if (active) return active;
    if (!existing && this.isClosing(request.command.affairId)) {
      return Promise.resolve(this.failure("affair_action_pending", "事务已有待确认关闭请求", true));
    }
    const record: AffairActionRecord = existing ?? {
      ...structuredClone(request), key, phase: "pending", updatedAt: new Date().toISOString(),
    };
    this.deps.state.affairActions.set(key, record);
    try {
      this.deps.persist();
    } catch {
      if (!existing) this.deps.state.affairActions.delete(key);
      return Promise.resolve(this.failure("affair_action_persist_failed", "关闭请求未能持久化", true));
    }
    this.notify();
    const operation = this.operations.run(request.command.affairId, () => this.run(record, ports));
    this.running.set(key, operation);
    void operation.finally(() => this.running.delete(key)).catch(() => undefined);
    return operation;
  }

  private async run(record: AffairActionRecord, ports: AffairActionPorts): Promise<AffairActionOutcome> {
    try {
      const rejected = precheckAffairClose(this.deps.state, record.command);
      if (rejected) return this.finishRejected(record, { ok: false, error: rejected });
      if (record.command.status === "canceled") await this.cancelChildren(record, ports);
      // runtime I/O 之后再核验当前 job；绝不拿请求中的完整快照覆盖新事实。
      const changed = precheckAffairClose(this.deps.state, record.command);
      if (changed) return this.finishRejected(record, { ok: false, error: changed });
      const result = this.commit(record);
      // 网络失败不撤销已经落盘的结果；同一请求重试可取回该结果。
      try {
        ports.sendEnvelope(createEnvelope({
          source: { kind: "companion", deviceId: ports.desktopDeviceId },
          target: { kind: "phone", deviceId: this.deps.state.connection.phoneDeviceId ?? record.actorId },
          type: "affair.close", correlationId: record.requestId, payload: { ...result },
        }));
      } catch { /* 已提交事实由原请求回执重放恢复。 */ }
      return { ok: true, result };
    } catch (error) {
      return this.failure("affair_action_unconfirmed", error instanceof Error ? error.message : "关闭尚未确认", true);
    }
  }

  private async cancelChildren(record: AffairActionRecord, ports: AffairActionPorts): Promise<void> {
    const { state, gate } = this.deps;
    const children = [...state.jobs.values()].filter((job) => job.affairId === record.command.affairId);
    for (const job of children) gate.revokeForJob(job.jobId);
    this.deps.persist();
    for (const job of children) {
      if (isTerminalJob(state.jobs.get(job.jobId)?.status ?? job.status)) continue;
      if (!ports.cancelJob) throw new Error("执行器不可用，不能确认子 job 已停止");
      await ports.cancelJob({ affairId: job.affairId, jobId: job.jobId });
      if (!isTerminalJob(state.jobs.get(job.jobId)?.status ?? "")) {
        throw new Error("取消请求已发出，但尚未取得 job 停止证据");
      }
      this.deps.persist();
    }
  }

  private commit(record: AffairActionRecord): AffairActionResult {
    const { state } = this.deps;
    const previous = state.affairs.get(record.command.affairId)!;
    const result: AffairActionResult = structuredClone({
      affair: { ...previous, status: record.command.status, blockedReason: null, resumeCondition: null },
      jobs: [...state.jobs.values()].filter((job) => job.affairId === previous.affairId),
    });
    const committed: AffairActionRecord = {
      ...record, phase: "committed", outcome: { ok: true, result }, updatedAt: new Date().toISOString(),
    };
    state.affairs.set(previous.affairId, result.affair);
    state.affairActions.set(record.key, committed);
    try {
      this.deps.persist();
    } catch (error) {
      state.affairs.set(previous.affairId, previous);
      state.affairActions.set(record.key, record);
      throw error;
    }
    this.notify();
    return result;
  }

  private finishRejected(record: AffairActionRecord, outcome: AffairActionOutcome): AffairActionOutcome {
    this.deps.state.affairActions.set(record.key, { ...record, phase: "rejected", outcome });
    try { this.deps.persist(); } catch (error) {
      this.deps.state.affairActions.set(record.key, record);
      throw error;
    }
    return outcome;
  }

  private notify(): void {
    try { this.deps.publish(); } catch { /* 通知失败不改变已经持久化的动作阶段。 */ }
  }

  private fingerprint(command: AffairActionRequest["command"]): string {
    return JSON.stringify([command.affairId, command.status, command.expectedCurrentJobId,
      command.acceptanceSummary ?? null, command.closeReason ?? null]);
  }

  private failure(code: string, message: string, retryable: boolean): AffairActionOutcome {
    return { ok: false, error: { code, message, retryable } };
  }
}
