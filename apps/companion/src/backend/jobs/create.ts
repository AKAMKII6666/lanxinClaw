/**
 * 新执行 job 的原子登记。
 * 职责：明确创建命令选择当前 job，与 needs_permission/去重证据共同持久化。
 * 不拥有：权限授予、run 执行、旧 job 事件抢占。副作用：写 backend 镜像。
 */
import { validateMessage, type JobPayload, type ProtocolEnvelope } from "@lanxin-claw/protocol";
import { applyProtocolEnvelopeToState } from "../../state/store.js";
import type { ApplyProtocolResult, CompanionBackendState } from "../../state/types.js";

/**
 * @param state 状态权威
 * @param command 已认证的创建命令
 * @param events needs_permission 和 permission.request 事实
 * @param persist 原子镜像持久化端口
 * @returns 提交结果；失败保留原 currentJobId 和 job 集合
 */
export function commitJobCreation(state: CompanionBackendState, command: ProtocolEnvelope,
  events: readonly ProtocolEnvelope[], persist: () => void): ApplyProtocolResult {
  const valid = validateMessage(command);
  if (!valid.ok || command.type !== "job.create") return { ok: false, code: "job_create_invalid", message: "需要有效 job.create 命令", retryable: false };
  const payload = command.payload as unknown as JobPayload;
  const affair = state.affairs.get(payload.affairId);
  if (!affair) return { ok: false, code: "affair_not_found", message: "找不到父事务", retryable: false };
  const draft = { ...state, affairs: new Map(state.affairs), jobs: new Map(state.jobs), seenMessages: new Map(state.seenMessages) };
  if (payload.purpose !== "exploration" || !affair.currentJobId) {
    draft.affairs.set(affair.affairId, { ...affair, currentJobId: payload.jobId });
  }
  for (const event of events) {
    const result = applyProtocolEnvelopeToState(draft, event);
    if (!result.ok) return result;
  }
  draft.seenMessages.set(command.messageId, { messageId: command.messageId, seenAt: draft.updatedAt });
  const previous = { affairs: state.affairs, jobs: state.jobs, seenMessages: state.seenMessages, updatedAt: state.updatedAt };
  Object.assign(state, { affairs: draft.affairs, jobs: draft.jobs, seenMessages: draft.seenMessages, updatedAt: draft.updatedAt });
  try { persist(); } catch {
    Object.assign(state, previous);
    return { ok: false, code: "job_create_persist_failed", message: "任务登记尚未持久化", retryable: true };
  }
  return { ok: true, envelope: command };
}
