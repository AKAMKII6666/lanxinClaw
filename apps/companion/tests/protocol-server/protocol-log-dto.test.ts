/**
 * 协议 DTO 落盘脱敏测试。
 *
 * 职责：验证调查日志只保留排障证据，不落明文 secret。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import { createProtocolLogDto } from "../../src/protocol-server/protocol-log-dto.js";

describe("protocol log dto", () => {
  it("redacts secret-like text values even when the field name is harmless", () => {
    const dto = createProtocolLogDto({
      protocolVersion: "0.2",
      messageId: "msg_dto_001",
      correlationId: "corr_dto_001",
      sentAt: "2026-08-30T16:39:43.000Z",
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "chat.context_attach",
      payload: {
        attachId: "attach_001",
        text: "debug token=abcdef1234567890 and Bearer abcdef1234567890",
        nested: {
          note: "authProof:proof_in_plain_text_123456",
        },
      },
    } as unknown as ProtocolEnvelope);

    const payload = dto.payload as { text?: string; nested?: { note?: string } };
    assert.equal(payload.text, "debug token=*** and Bearer ***");
    assert.equal(payload.nested?.note, "authProof:***");
    assert.doesNotMatch(JSON.stringify(dto), /abcdef1234567890|proof_in_plain_text_123456/);
  });
});
