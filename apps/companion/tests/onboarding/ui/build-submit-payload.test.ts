/**
 * ????????????
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildQwenSubmitPayload,
  buildSubmitPayload,
} from "../../../src/ui/pages/onboarding/build-submit-payload.js";

test("buildQwenSubmitPayload??? Legacy ?? + qwen3.7-plus", () => {
  const result = buildQwenSubmitPayload({
    apiKey: "sk-qwen",
    regionId: "cn-beijing",
    modelId: "qwen3.7-plus",
    advancedOpen: false,
    workspaceId: "",
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.provider, "qwen");
    assert.equal(result.value.endpoint, "https://dashscope.aliyuncs.com/compatible-mode/v1");
    assert.equal(result.value.modelRef, "qwen/qwen3.7-plus");
  }
});

test("buildQwenSubmitPayload?advanced ? workspaceId ??", () => {
  const result = buildQwenSubmitPayload({
    apiKey: "sk-qwen",
    regionId: "cn-beijing",
    modelId: "qwen3.7-plus",
    advancedOpen: true,
    workspaceId: "  ",
  });
  assert.ok(!result.ok);
});

test("buildQwenSubmitPayload?advanced + workspaceId ??????", () => {
  const result = buildQwenSubmitPayload({
    apiKey: "sk-qwen",
    regionId: "cn-beijing",
    modelId: "qwen3.7-plus",
    advancedOpen: true,
    workspaceId: "ws-demo",
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.match(result.value.endpoint ?? "", /ws-demo\.cn-beijing\.maas\.aliyuncs\.com/);
  }
});

test("buildQwenSubmitPayload???? advanced ?? workspaceId", () => {
  const result = buildQwenSubmitPayload({
    apiKey: "sk-qwen",
    regionId: "us-virginia",
    modelId: "qwen3.7-plus",
    advancedOpen: true,
    workspaceId: "ws-ignored",
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.endpoint, "https://dashscope-us.aliyuncs.com/compatible-mode/v1");
  }
});

test("buildSubmitPayload?qwen ? openai ??", () => {
  const qwen = buildSubmitPayload(
    "qwen",
    {
      apiKey: "sk-qwen",
      regionId: "cn-beijing",
      modelId: "qwen3.7-plus",
      advancedOpen: false,
      workspaceId: "",
    },
    { apiKey: "ignored", endpoint: "", modelRef: "" },
  );
  assert.ok(qwen.ok);
  if (qwen.ok) {
    assert.equal(qwen.value.provider, "qwen");
  }

  const openai = buildSubmitPayload(
    "openai",
    {
      apiKey: "",
      regionId: "",
      modelId: "",
      advancedOpen: false,
      workspaceId: "",
    },
    { apiKey: "sk-oai", endpoint: "", modelRef: "openai/gpt-5.5" },
  );
  assert.ok(openai.ok);
  if (openai.ok) {
    assert.equal(openai.value.provider, "openai");
    assert.equal(openai.value.modelRef, "openai/gpt-5.5");
  }
});
