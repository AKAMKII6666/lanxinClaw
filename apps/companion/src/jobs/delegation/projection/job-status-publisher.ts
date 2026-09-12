/**
 * 委派结果的携证投递。
 * 职责：合法接受/终态顺序、backend 提交后发送、事务投影去重。
 * 不拥有：权限裁决、runtime 调用和轮询。副作用：经注入端口提交和发送。
 */
import type { JobStatus, ProtocolEnvelope } from "@lanxin-claw/protocol";
import type { AdapterJobRecord } from "@lanxin-claw/openclaw-adapter";
import type { JobDelegatorDeps } from "../delegator-types.js";
import { outboundIdentityFromDeps } from "../delegator-context.js";
import { statusToEnvelopeType } from "../delegator-payload.js";
import { buildAffairUpdateEnvelope, buildJobEnvelope, type DelegatorJobProjection } from "./delegator-outbound.js";

/** backend 已提交才允许向 phone 发布的唯一委派投递入口。 */
export class JobStatusPublisher {
  private readonly affairLastStatus = new Map<string, string>();

  /** @param deps 状态提交及发送端口 */
  constructor(private readonly deps: JobDelegatorDeps) {}

  /**
   * 发布 create/reconcile 的受信 run 快照；即时完成先补齐真实接受事实。
   * @param job adapter 已登记且身份已校验的结果
   * @returns 所需状态是否全部成功提交
   */
  publishCreated(job: AdapterJobRecord): boolean {
    const previous = this.deps.getJobStatus(job.jobId);
    const needsAccepted = (previous === "needs_permission" || previous === "queued") &&
      ["queued", "running", "completed"].includes(job.status);
    if (needsAccepted) {
      if (!job.openclawRunId) {
        this.deps.logger?.warn({ jobId: job.jobId }, "缺少 runtime 接受身份，拒绝预写 running");
        return false;
      }
      const accepted = this.apply(buildJobEnvelope({
        identity: outboundIdentityFromDeps(this.deps), type: "job.accepted", status: "running",
        job: { ...job, progressSummary: "OpenClaw 已接受执行", resultDigest: null, evidenceQuality: "missing" },
      }));
      if (!accepted) return false;
      if (job.status === "queued" || job.status === "running") return true;
    }
    if (job.status === "queued" && previous === "running") return true;
    return this.publish(job.status, job);
  }

  /**
   * 提交执行状态；错误必须由调用方保留并重试，不能被当作成功。
   * @param status 已裁决状态
   * @param job job 投影
   * @returns 是否已提交
   */
  publish(status: JobStatus, job: DelegatorJobProjection): boolean {
    return this.apply(buildJobEnvelope({
      identity: outboundIdentityFromDeps(this.deps), type: statusToEnvelopeType(status), status, job,
    }));
  }

  /**
   * 仅在 backend 中的事务状态变化后发送投影。
   * @param affairId 事务 ID
   * @returns 是否已提交或无需发送
   */
  projectAffair(affairId: string): boolean {
    const affair = this.deps.getAffair?.(affairId);
    if (!affair || this.affairLastStatus.get(affairId) === affair.status) return true;
    if (!this.apply(buildAffairUpdateEnvelope(outboundIdentityFromDeps(this.deps), affair))) return false;
    this.affairLastStatus.set(affairId, affair.status);
    return true;
  }

  private apply<T>(envelope: ProtocolEnvelope<T>): boolean {
    try {
    const applied = this.deps.applyProtocolEnvelope(envelope);
    if (!applied.ok) {
      this.deps.logger?.warn({ type: envelope.type, code: applied.code }, "delegator apply 失败，保留待投递结果");
      return false;
    }
    if (this.deps.getPhoneDeviceId()) this.deps.sendEnvelope(envelope);
    return true;
    } catch (error) {
      this.deps.logger?.warn({ type: envelope.type, error: String(error) }, "delegator 提交或发送异常，保留待投递结果");
      return false;
    }
  }
}
