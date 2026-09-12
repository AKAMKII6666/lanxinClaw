/**
 * WS 请求结果的统一发送。
 * 职责：回执关联原请求、归一错误；不拥有业务提交和身份认证。副作用：写 socket。
 */
import type { WebSocket } from "ws";
import { PROTOCOL_VERSION, type AffairActionResult } from "@lanxin-claw/protocol";
import { sendJson } from "./router-utils.js";
import type { HandleProtocolSocketMessageInput } from "./router.js";

/** handler 处理结果，由公共发送函数补关联信息。 */
export interface RequestReplyBody {
  /** 业务是否已提交 */
  ok: boolean;
  /** 成功类型；兼容 handler 明示，最终以请求类型为准 */
  acceptedType?: string;
  /** 重复已提交请求 */
  duplicate?: boolean;
  /** 关闭动作已提交事实 */
  result?: AffairActionResult;
  /** 失败原因；额外的内部处理字段不会原样泄露 */
  error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
}

/**
 * 发送精确关联回执；解析失败的请求只回显可辨认 ID，不表示已认证。
 * @param socket 来源 socket
 * @param request 原始或已校验请求
 * @param body 处理结果
 */
export function sendRequestResult(socket: WebSocket, request: unknown, body: RequestReplyBody): void {
  const raw = request && typeof request === "object" ? request as Record<string, unknown> : {};
  const correlationId = typeof raw.messageId === "string" && raw.messageId.trim() ? raw.messageId : null;
  const type = typeof raw.type === "string" && raw.type.trim() ? raw.type : null;
  if (body.ok) {
    if (!correlationId || !type) throw new Error("request_context_missing");
    sendJson(socket, {
      protocolVersion: PROTOCOL_VERSION, ok: true, correlationId, acceptedType: type,
      ...(body.duplicate ? { duplicate: true } : {}), ...(body.result ? { result: body.result } : {}),
    });
    return;
  }
  const error = body.error ?? { code: "request_failed", message: "请求未提交", retryable: false };
  sendJson(socket, {
    protocolVersion: PROTOCOL_VERSION, ok: false, correlationId, rejectedType: type,
    error: { code: error.code, message: error.message, retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}) },
  });
}

/**
 * 使用显式 handler 请求上下文发送回执；不同并发请求不共享可变 socket 上下文。
 * @param input 当前请求
 * @param body 业务结果
 */
export function replyRequest(input: HandleProtocolSocketMessageInput, body: RequestReplyBody): void {
  sendRequestResult(input.socket, input.request, body);
}
