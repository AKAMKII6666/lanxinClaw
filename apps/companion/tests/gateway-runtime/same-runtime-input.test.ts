/**
 * Gateway 启动入参等价比较单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sameGatewayRuntimeInput } from "../../src/gateway-runtime/same-runtime-input.js";
import type { StartGatewayRuntimeInput } from "../../src/gateway-runtime/service.js";

const base: StartGatewayRuntimeInput = {
  provider: "openai",
  apiKey: "sk-a",
  endpoint: null,
  modelRef: "openai/gpt-5.5",
  workspace: "C:/ws",
  enableWebSearch: false,
  enableBrowser: false,
  webSearchApiKey: "",
};

test("相同配置可复用 gateway", () => {
  assert.equal(sameGatewayRuntimeInput(base, { ...base }), true);
});

test("启用/关闭 browser 视为配置变更", () => {
  assert.equal(
    sameGatewayRuntimeInput(base, { ...base, enableBrowser: true }),
    false,
  );
});

test("web search key 变更视为配置变更", () => {
  assert.equal(
    sameGatewayRuntimeInput(base, { ...base, webSearchApiKey: "brave-new" }),
    false,
  );
});
