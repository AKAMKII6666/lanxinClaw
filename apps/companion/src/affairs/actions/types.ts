/** 事务动作与持久化结果；不拥有执行器或传输，无 I/O。 */
import type { AffairActionResult, AffairClosePayload, ProtocolEnvelope, ProtocolError } from "@lanxin-claw/protocol";

/** 同一设备的请求 ID 是幂等键；原载荷不能改写。 */
export interface AffairActionRequest {
  requestId: string;
  actorId: string;
  command: AffairClosePayload;
}

/** 已提交结果与拒绝原因。retryable 表示尚未确定业务结果。 */
export type AffairActionOutcome =
  | { ok: true; result: AffairActionResult; duplicate?: boolean }
  | { ok: false; error: ProtocolError };

/** 关闭阶段独立于 affair 执行状态；pending 绝不冒充 canceled/closed。 */
export interface AffairActionRecord extends AffairActionRequest {
  key: string;
  phase: "pending" | "committed" | "rejected";
  updatedAt: string;
  outcome?: AffairActionOutcome;
}

/** UI 与 WS 都注入相同执行器；广播只能发送已提交事实。 */
export interface AffairActionPorts {
  desktopDeviceId: string;
  cancelJob?: (input: { affairId: string; jobId: string }) => Promise<void>;
  sendEnvelope: (envelope: ProtocolEnvelope) => void;
}
