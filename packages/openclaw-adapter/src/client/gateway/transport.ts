/**
 * OpenClaw Gateway 传输窄接口。
 *
 * 职责：隔离官方 gateway client、raw WebSocket 与测试 fake。
 * 不拥有：Lanxing job store、权限裁决、affair 生命周期。
 * 副作用：真实实现会产生网络 I/O；fake 仅内存。
 */

import type { OpenClawRunSnapshot } from "../runtime-client.js";

/**
 * Gateway 创建 run 的入参。
 */
export interface GatewayCreateRunRequest {
  /** Gateway agent id */
  agentId: string;
  /** 幂等键（agent 方法 idempotencyKey）；缺省按 sessionKey 派生 */
  idempotencyKey?: string | null;
  /** 交给 agent 的输入 */
  input: string;
  /** 会话键；绑定 Lanxing job */
  sessionKey: string;
  /** 工作区提示；可空 */
  workspaceHint: string | null;
  /** 已由 companion 裁决的 scope 摘要 */
  scopes: readonly string[];
  /** 超时毫秒；可空 */
  timeoutMs: number | null;
}

/**
 * Gateway transport。
 */
export interface GatewayTransport {
  /**
   * 创建 Gateway run。
   *
   * @param request 创建参数
   * @returns 规范化 run 快照
   */
  createRun(request: GatewayCreateRunRequest): Promise<OpenClawRunSnapshot>;

  /**
   * 获取 Gateway run。
   *
   * @param runId run id
   * @returns 规范化 run 快照
   */
  getRun(runId: string): Promise<OpenClawRunSnapshot>;

  /**
   * 取消 Gateway run。
   *
   * @param runId run id
   * @returns 规范化 run 快照
   */
  cancelRun(runId: string): Promise<OpenClawRunSnapshot>;
}

/**
 * Gateway transport 错误。
 */
export class GatewayTransportError extends Error {
  /** 稳定错误码 */
  readonly code: string;
  /** 是否可重试 */
  readonly retryable: boolean;

  /**
   * @param code 错误码
   * @param message 错误消息
   * @param retryable 是否可重试
   */
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "GatewayTransportError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * 构造明确不可用的 Gateway transport；不得静默降级 mock。
 *
 * @param reason 不可用原因
 * @returns transport
 */
export function createUnavailableGatewayTransport(reason: string): GatewayTransport {
  const fail = async (): Promise<never> => {
    throw new GatewayTransportError("gateway_unavailable", reason, true);
  };
  return {
    createRun: fail,
    getRun: fail,
    cancelRun: fail,
  };
}
