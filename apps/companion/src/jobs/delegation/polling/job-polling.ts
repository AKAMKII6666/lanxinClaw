/**
 * 委派跟踪与投递恢复。
 * 职责：串行读取 runtime、保留未提交结果、同时确认 job 与事务投影后停止。
 * 不拥有：授权、创建 run、关闭事务。副作用：定时器、adapter 读取和投递端口。
 */
import type { AdapterJobRecord, AdapterJobResult } from "@lanxin-claw/openclaw-adapter";
import { DEFAULT_JOB_POLL_INTERVAL_MS, IN_FLIGHT_PLACEHOLDER, POLL_STOP_JOB_STATUSES,
  type ActivePoll, type JobDelegatorDeps, type PendingJobPublication } from "../delegator-types.js";
import { buildRuntimeReadFailureJob, type DelegatorJobProjection } from "../projection/delegator-outbound.js";
import { jobStatusFingerprint } from "../projection/job-status-fingerprint.js";
import type { JobStatusPublisher } from "../projection/job-status-publisher.js";

/** 对已登记的 job 保持唯一跟踪；投递失败不会丢掉终态证据。 */
export class JobPolling {
  /** @param deps 运行和状态端口 @param active 与委派入口共享的登记表 @param publisher 唯一投递入口 */
  constructor(private readonly deps: JobDelegatorDeps,
    private readonly active: Map<string, ActivePoll | typeof IN_FLIGHT_PLACEHOLDER>,
    private readonly publisher: JobStatusPublisher) {}

  /**
   * 提交并按需跟踪一份受信 runtime 结果。
   * @param job runtime 结果
   * @returns job 与事务投影是否均已提交
   */
  accept(job: AdapterJobRecord): boolean {
    const publication: PendingJobPublication = { kind: "adapter", job };
    const committed = this.commit(publication);
    this.stop(job.jobId);
    if (!committed || !POLL_STOP_JOB_STATUSES.includes(job.status)) {
      this.track(job, committed ? null : publication, committed ? jobStatusFingerprint(job) : "");
    }
    return committed;
  }

  /** @param job 已裁决失败；提交失败时仅重试投递，不再访问 runtime */
  fail(job: DelegatorJobProjection): void {
    const publication: PendingJobPublication = { kind: "failure", job };
    this.stop(job.jobId);
    if (!this.commit(publication)) this.track(job, publication);
  }

  /** @param jobId 恢复既有 run；不得重新 create */
  async restore(jobId: string): Promise<void> {
    const operation = async () => {
      if (this.active.has(jobId)) return;
      const status = this.deps.getJobStatus(jobId);
      if (!["needs_permission", "queued", "running", "blocked"].includes(status ?? "")) return;
      const read = await this.deps.adapter.readJob(jobId, { refresh: true });
      if (read.ok) this.accept(read.job);
      else await this.retainRestoreFailure(jobId, read);
    };
    const affairId = this.deps.getJob?.(jobId)?.affairId;
    if (affairId && this.deps.runAffairOperation) await this.deps.runAffairOperation(affairId, operation);
    else await operation();
  }

  private async retainRestoreFailure(jobId: string, read: Extract<AdapterJobResult, { ok: false }>): Promise<void> {
    const cached = await this.deps.adapter.readJob(jobId, { refresh: false });
    const previous = cached.ok ? cached.job : this.deps.getJob?.(jobId);
    if (!previous) return;
    const projection = { ...previous, progressSummary: previous.progressSummary ?? "",
      blockedReason: previous.blockedReason ?? null, resumeCondition: previous.resumeCondition ?? null };
    if (read.retryable) this.track(projection, null);
    else this.fail(buildRuntimeReadFailureJob(projection, read.message, read.code));
  }

  /** @param jobId 停止单个跟踪 */
  stop(jobId: string): void {
    const poll = this.active.get(jobId);
    if (poll && poll !== IN_FLIGHT_PLACEHOLDER) clearInterval(poll.timer);
    this.active.delete(jobId);
  }

  /** 应用退出时释放全部定时器。 */
  stopAll(): void { for (const id of this.active.keys()) this.stop(id); }

  private commit(publication: PendingJobPublication): boolean {
    const applied = publication.kind === "adapter"
      ? this.publisher.publishCreated(publication.job)
      : this.publisher.publish("failed", publication.job);
    return applied && this.publisher.projectAffair(publication.job.affairId);
  }

  private track(job: DelegatorJobProjection, pendingPublication: PendingJobPublication | null, lastFingerprint = ""): void {
    const poll: ActivePoll = {
      pendingPublication, lastFingerprint, lastJob: job, inFlight: false,
      timer: setInterval(() => this.schedule(job.jobId), this.deps.pollIntervalMs ?? DEFAULT_JOB_POLL_INTERVAL_MS),
    };
    this.active.set(job.jobId, poll);
  }

  private schedule(jobId: string): void {
    const poll = this.active.get(jobId);
    if (!poll || poll === IN_FLIGHT_PLACEHOLDER || poll.inFlight) return;
    // 入队前占位；长时间事务操作不会在队列堆积无限 tick。
    poll.inFlight = true;
    const execute = () => this.tick(jobId, poll);
    const operation = this.deps.runAffairOperation
      ? this.deps.runAffairOperation(poll.lastJob.affairId, execute) : execute();
    void operation.catch((error) => this.deps.logger?.warn({ jobId, error: String(error) }, "轮询暂未确认"))
      .finally(() => { poll.inFlight = false; });
  }

  private async tick(jobId: string, poll: ActivePoll): Promise<void> {
    if (this.active.get(jobId) !== poll) return;
    if (poll.pendingPublication) {
      this.retry(jobId, poll);
      return;
    }
    const read = await this.deps.adapter.readJob(jobId, { refresh: true });
    if (this.active.get(jobId) !== poll) return;
    if (!read.ok) {
      this.deps.logger?.warn({ jobId, code: read.code }, "adapter 读取失败");
      if (!read.retryable) {
        poll.pendingPublication = { kind: "failure", job: buildRuntimeReadFailureJob(poll.lastJob, read.message, read.code) };
        this.retry(jobId, poll);
      }
      return;
    }
    poll.lastJob = read.job;
    if (jobStatusFingerprint(read.job) === poll.lastFingerprint) return;
    poll.pendingPublication = { kind: "adapter", job: read.job };
    this.retry(jobId, poll);
  }

  private retry(jobId: string, poll: ActivePoll): void {
    const pending = poll.pendingPublication;
    if (!pending || !this.commit(pending)) return;
    poll.pendingPublication = null;
    if (pending.kind === "failure" || POLL_STOP_JOB_STATUSES.includes(pending.job.status)) {
      this.stop(jobId);
    } else {
      poll.lastFingerprint = jobStatusFingerprint(pending.job);
    }
  }
}
