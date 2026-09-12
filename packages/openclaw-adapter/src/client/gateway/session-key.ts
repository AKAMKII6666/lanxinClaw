/**
 * OpenClaw Gateway sessionKey 规范化。
 *
 * 职责：把 Lanxing job 会话键对齐到 Gateway canonical 形态 `agent:<agentId>:lanxing-job:<jobId>`。
 * 不拥有：run 创建/取消、store 持久化、权限裁决。
 * 纯函数：无 I/O。
 *
 * 背景：Gateway 登记 active run 时用 canonicalizeSessionKeyForAgent；chat.abort 用请求里的
 * sessionKey 精确匹配。裸 `lanxing-job:…` 会导致 INVALID_REQUEST: runId does not match sessionKey。
 */

/** 默认 agentId（companion 自托管固定 main）。 */
export const DEFAULT_GATEWAY_AGENT_ID = "main";

/**
 * 由 jobId 构造 Gateway canonical sessionKey。
 *
 * @param jobId Lanxing job id
 * @param agentId OpenClaw agent id；默认 main
 * @returns `agent:<agentId>:lanxing-job:<jobId>`
 */
export function toGatewaySessionKey(
  jobId: string,
  agentId: string = DEFAULT_GATEWAY_AGENT_ID,
): string {
  const id = jobId.trim();
  const agent = agentId.trim() || DEFAULT_GATEWAY_AGENT_ID;
  return `agent:${agent}:lanxing-job:${id}`;
}

/**
 * 将任意历史/裸 sessionKey 规范为 Gateway canonical 形态。
 *
 * @param raw 已存或传入的 sessionKey；可空
 * @param agentId OpenClaw agent id；默认 main
 * @param jobId 当 raw 缺失时用于推导；可空
 * @returns canonical key；无法推导时返回 null
 */
export function canonicalizeGatewaySessionKey(
  raw: string | null | undefined,
  agentId: string = DEFAULT_GATEWAY_AGENT_ID,
  jobId?: string | null,
): string | null {
  const agent = agentId.trim() || DEFAULT_GATEWAY_AGENT_ID;
  const trimmed = raw?.trim() ?? "";
  if (trimmed.startsWith("agent:")) {
    return trimmed;
  }
  if (trimmed.startsWith("lanxing-job:")) {
    return `agent:${agent}:${trimmed}`;
  }
  const id = jobId?.trim() ?? "";
  if (id) {
    return toGatewaySessionKey(id, agent);
  }
  if (trimmed) {
    return `agent:${agent}:${trimmed}`;
  }
  return null;
}

/**
 * 判断 evidence / 请求侧 sessionKey 是否与 job 期望等价（legacy ↔ canonical）。
 *
 * @param expected 期望值（通常为 store 中的 openclawSessionKey 或 canonical）
 * @param actual 实际值
 * @param jobId job id（用于双方都可推导时）
 * @param agentId agent id
 * @returns 是否等价
 */
export function sessionKeysEquivalent(
  expected: string | null | undefined,
  actual: string | null | undefined,
  jobId: string,
  agentId: string = DEFAULT_GATEWAY_AGENT_ID,
): boolean {
  if (!actual) {
    return true;
  }
  const left =
    canonicalizeGatewaySessionKey(expected, agentId, jobId) ??
    toGatewaySessionKey(jobId, agentId);
  const right = canonicalizeGatewaySessionKey(actual, agentId, jobId);
  return right !== null && left === right;
}

/**
 * 稳定幂等键（与 sessionKey 解耦，避免改 session 形态破坏幂等）。
 *
 * @param jobId Lanxing job id
 * @returns `lanxing-job:<jobId>`
 */
export function toJobIdempotencyKey(jobId: string): string {
  return `lanxing-job:${jobId.trim()}`;
}
