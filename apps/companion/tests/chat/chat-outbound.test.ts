/**
 * 张老板 chat 出站构造与演示面板单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContextAttach,
  buildUserChatMessage,
  guessContentKind,
} from "../../src/chat/build-outbound.js";
import { createDemoZhangBossPanel } from "../../src/chat/demo-panel-state.js";

describe("zhang-boss chat outbound", () => {
  it("演示面板含在线态与当前事务且无凭据字段", () => {
    const panel = createDemoZhangBossPanel();
    assert.equal(panel.presence, "supervising");
    assert.ok(panel.currentAffair);
    assert.ok(panel.messages.length >= 1);
    assert.ok(panel.attachHistory.length >= 1);
    assert.equal(JSON.stringify(panel).includes("apiKey"), false);
    assert.equal(JSON.stringify(panel).includes("pairingSecret"), false);
  });

  it("buildUserChatMessage / context_attach 通过协议校验", () => {
    const message = buildUserChatMessage(
      "F:/workspace/xxx/src/main.ts",
      "affair_fix_code_001",
      "2026-07-23T02:00:00.000Z",
    );
    assert.equal(message.ok, true);
    if (message.ok) {
      assert.equal(message.value.authorKind, "user");
    }

    const attach = buildContextAttach(
      "F:/workspace/xxx/src/main.ts",
      "affair",
      "path",
      "affair_fix_code_001",
      "2026-07-23T02:01:00.000Z",
    );
    assert.equal(attach.ok, true);

    const missingAffair = buildContextAttach("note", "affair", "note", null);
    assert.equal(missingAffair.ok, false);
  });

  it("guessContentKind 识别 url / path / log", () => {
    assert.equal(guessContentKind("https://example.com/a"), "url");
    assert.equal(guessContentKind("F:/workspace/xxx/a.ts"), "path");
    assert.equal(guessContentKind("Error: failed\nstack"), "log");
    assert.equal(guessContentKind("请看这里"), "note");
  });
});
