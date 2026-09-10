/** 用户发送文字不能继承桌面当前事务或改变原文。 */
import assert from "node:assert/strict";
import { it } from "node:test";
import type { RendererBridgeApi } from "../../src/ui/bridge/renderer-api.js";
import type { BridgeUiAction } from "../../src/bridge/contract.js";
import { createZhangBossComposerBindings } from "../../src/ui/pages/zhang-boss/zhang-boss-composer-bindings.js";

it("composer 仅提交未归属消息；后端拒绝或保存失败时不能清空草稿", async () => {
  const actions: BridgeUiAction[] = [];
  let cleared = 0;
  const errors: string[] = [];
  const bridge = { submitAction: async (action: BridgeUiAction) => {
    actions.push(action);
    return { ok: false, error: { code: "phone_required", message: "先确认收件电话", retryable: false } };
  } } as RendererBridgeApi;
  const draft = "  路径和说明\n尾部  ";
  const bindings = createZhangBossComposerBindings({ bridge, draft,
    fail: (message) => errors.push(message), onOk: () => { cleared++; } });
  bindings.onSendMessage();
  await new Promise(setImmediate);
  assert.deepEqual(actions, [{ type: "chat.sendMessage", text: draft, affairId: null }]);
  assert.equal(cleared, 0);
  assert.deepEqual(errors, ["先确认收件电话"]);
});
