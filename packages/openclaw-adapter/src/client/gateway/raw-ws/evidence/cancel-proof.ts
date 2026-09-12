/**
 * Gateway 取消证明裁决。
 * 职责：识别匹配目标的取消回执并校验运行结束事实。
 * 不拥有：业务状态提交、权限裁决、WebSocket 连接。
 * 纯函数：无 I/O。
 */
import type { OpenClawRunSnapshot } from "../../../runtime-client.js";
import { GatewayTransportError } from "../../transport.js";

/**
 * abort 接受请求不代表停止；两种合法回执均须继续读取终态。
 * @param ack 已认证 Gateway chat.abort 的载荷
 * @param runId 本次取消目标
 * @returns 回执声明；缺证明或错目标抛可重试错误
 */
export function readAbortProof(ack: Record<string, unknown>, runId: string): "aborted" | "observe" {
  if (ack.ok !== true || typeof ack.aborted !== "boolean" || !Array.isArray(ack.runIds)) {
    throw unconfirmed("Gateway 未返回取消的目标 run 证明");
  }
  if (ack.aborted === false && ack.runIds.length === 0) return "observe";
  if (!ack.aborted || ack.runIds.length !== 1 || ack.runIds[0] !== runId) {
    throw unconfirmed("Gateway 取消证明与目标 run 不匹配");
  }
  return "aborted";
}

/**
 * 保留自然终态；只有稳定 abort 原因能将 error/ok 归一为 cancelled。
 * @param observed 取消回执之后 agent.wait 读取的真实快照
 * @param runId 本次取消目标
 * @returns 已停止的原快照或携带 abort 终结证据的取消快照；活跃状态抛错
 */
export function requireStoppedRun(observed: OpenClawRunSnapshot, runId: string): OpenClawRunSnapshot {
  if (observed.runId !== runId || !["completed", "failed", "cancelled", "timed_out"].includes(observed.status)) {
    throw unconfirmed("Gateway 未停止该 run，读取后仍未取得对应终态");
  }
  if (observed.status === "cancelled" || observed.evidence?.wait?.stopReason === "aborted") {
    return { ...observed, status: "cancelled", summary: "OpenClaw 已确认停止",
      ...(observed.evidence ? { evidence: { ...observed.evidence, localCancelAck: true } } : {}) };
  }
  return observed;
}

function unconfirmed(message: string): GatewayTransportError {
  return new GatewayTransportError("gateway_cancel_unconfirmed", message, true);
}
