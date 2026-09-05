/**
 * 协议调查日志 DTO。
 *
 * 职责：把协议 envelope 转为可落盘、已脱敏的调查证据。
 * 不拥有：协议校验、状态迁移、WebSocket 生命周期。
 */

import type { ProtocolEnvelope } from "@lanxin-claw/protocol";

export function createProtocolLogDto(input: ProtocolEnvelope | string): Record<string, unknown> {
  if (typeof input === "string") {
    try {
      return createProtocolLogDto(JSON.parse(input) as ProtocolEnvelope);
    } catch {
      return { parseError: "invalid_json", rawLength: input.length };
    }
  }
  return {
    protocolVersion: input.protocolVersion,
    messageId: input.messageId,
    correlationId: input.correlationId ?? null,
    sentAt: input.sentAt,
    source: input.source,
    target: input.target,
    type: input.type,
    payload: redactForProtocolLog(input.payload, 0),
  };
}

function shouldRedactProtocolKey(key: string): boolean {
  return /secret|token|password|auth|proof|credential|private|api[-_]?key/i.test(key);
}

function redactSensitiveProtocolText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer ***")
    .replace(
      /((?:api[_-]?key|token|secret|password|authProof|pairingSecret|credential)\s*[:=]\s*)[^\s,;"}]+/gi,
      "$1***",
    );
}

function redactForProtocolLog(value: unknown, depth: number): unknown {
  if (depth > 5) {
    return "[max-depth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => redactForProtocolLog(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, 80)) {
      out[key] = shouldRedactProtocolKey(key) ? "[redacted]" : redactForProtocolLog(child, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    const redacted = redactSensitiveProtocolText(value);
    if (redacted.length > 1_000) {
      return `${redacted.slice(0, 1_000)}...`;
    }
    return redacted;
  }
  return value;
}
