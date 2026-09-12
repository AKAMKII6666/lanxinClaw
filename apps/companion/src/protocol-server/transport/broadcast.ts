/** 协议出站：本地 apply 成功后再向认证 socket 发送。 */
import { type ProtocolEnvelope } from "@lanxin-claw/protocol";
import { type WebSocket } from "ws";
import type { ApplyProtocolResult } from "../../state/types.js";
import { shouldSendEnvelopeToSocket } from "../guards/ws/ws-audience.js";
import { createProtocolLogDto } from "../protocol-log-dto.js";
import type {
CompanionProtocolServerOptions
} from "../server-types.js";


/**
 * 创建广播与纯发送函数。
 *
 * @param options 选项
 * @param clients 客户端集合
 * @returns broadcast（apply+send）与 sendEnvelope（仅 send）
 */
export function createProtocolBroadcaster(
  options: CompanionProtocolServerOptions,
  clients: Set<WebSocket>,
  authenticatedSockets: Set<WebSocket>,
): {
  broadcast: (envelope: ProtocolEnvelope) => ApplyProtocolResult;
  sendEnvelope: (envelope: ProtocolEnvelope) => void;
} {
  const sendEnvelope = (envelope: ProtocolEnvelope): void => {
    const text = JSON.stringify(envelope);
    let sentCount = 0;
    let skippedCount = 0;
    for (const client of clients) {
      if (client.readyState !== client.OPEN) {
        skippedCount += 1;
        continue;
      }
      if (!shouldSendEnvelopeToSocket(envelope.type, authenticatedSockets.has(client))) {
        skippedCount += 1;
        continue;
      }
      client.send(text);
      sentCount += 1;
    }
    options.logger?.info(
      {
        event: "protocol.outbound.dto",
        dto: createProtocolLogDto(envelope),
        sentCount,
        skippedCount,
      },
      "协议出站 DTO",
    );
  };
  const broadcast = (envelope: ProtocolEnvelope): ApplyProtocolResult => {
    const applied = options.backend.applyProtocolEnvelope(envelope);
    if (!applied.ok) {
      options.logger?.warn(
        { event: "protocol.broadcast.apply_failed", dto: createProtocolLogDto(envelope), applied },
        "协议广播 apply 失败",
      );
      return applied;
    }
    options.logger?.info(
      { event: "protocol.broadcast.applied", dto: createProtocolLogDto(envelope) },
      "协议广播已写入状态",
    );
    sendEnvelope(envelope);
    return applied;
  };
  return { broadcast, sendEnvelope };
}
