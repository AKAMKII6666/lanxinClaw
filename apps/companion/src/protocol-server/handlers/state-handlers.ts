/** 通用状态入站：来源归一化、apply 与请求绑定的回执。 */
import {
type ProtocolEnvelope
} from "@lanxin-claw/protocol";
import { type WebSocket } from "ws";
import { sendRequestResult } from "../request-reply.js";
import type { CompanionProtocolServerOptions } from "../server.js";


/**
 * 应用到 backend。
 */
export function applyToBackend(
  options: CompanionProtocolServerOptions,
  envelope: ProtocolEnvelope,
  socket: WebSocket,
): void {
  let normalized = envelope;
  if (envelope.type === "chat.message" && envelope.source.kind === "phone") {
    const payload = envelope.payload as { authorKind?: unknown };
    const authorKind = payload.authorKind === "zhang-boss" ? "zhang-boss" : "user";
    normalized = {
      ...envelope,
      payload: { ...envelope.payload as object, authorKind },
    } as ProtocolEnvelope;
  }
  const applied = options.backend.applyProtocolEnvelope(normalized);
  if (!applied.ok) {
    sendRequestResult(socket, envelope, { ok: false, error: applied });
    return;
  }
  sendRequestResult(socket, envelope, {
    ok: true,
    acceptedType: envelope.type,
    ...(applied.duplicate ? { duplicate: true } : {}),
  });
}
