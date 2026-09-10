/** 单一消息入口；事务归属由电话与用户讨论后确认。 */
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { submitZhangBossMessage } from "./zhang-boss-actions.js";

export interface ZhangBossComposerBindingsInput {
  bridge: RendererBridgeApi;
  draft: string;
  fail: (message: string) => void;
  onOk: (text: string) => void;
}

export function createZhangBossComposerBindings(input: ZhangBossComposerBindingsInput): {
  onSendMessage: () => void;
} {
  return { onSendMessage: () => submitZhangBossMessage(input.bridge, input.draft, null, input.fail, input.onOk) };
}
