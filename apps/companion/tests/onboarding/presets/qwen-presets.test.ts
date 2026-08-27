/**
 * 千问 onboarding preset 测试。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QWEN_DEFAULT_MODEL_ID,
  QWEN_DEFAULT_REGION_ID,
  isAllowedQwenEndpoint,
  isAllowedQwenModelRef,
  resolveQwenOnboarding,
  validateQwenOnboardingFields,
} from "../../../src/onboarding/presets/qwen.js";

test("resolveQwenOnboarding：Legacy 北京 + qwen3.7-plus", () => {
  const result = resolveQwenOnboarding({
    regionId: QWEN_DEFAULT_REGION_ID,
    modelId: QWEN_DEFAULT_MODEL_ID,
  });
  assert.equal(result.endpoint, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(result.modelRef, "qwen/qwen3.7-plus");
});

test("resolveQwenOnboarding：四地域 Legacy URL", () => {
  const cases = [
    ["cn-beijing", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
    ["intl-sg", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"],
    ["us-virginia", "https://dashscope-us.aliyuncs.com/compatible-mode/v1"],
    ["cn-hongkong", "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1"],
  ] as const;
  for (const [regionId, expectedUrl] of cases) {
    const result = resolveQwenOnboarding({ regionId, modelId: "qwen3.5-flash" });
    assert.equal(result.endpoint, expectedUrl);
    assert.equal(result.modelRef, "qwen/qwen3.5-flash");
  }
});

test("resolveQwenOnboarding：五模型 modelRef", () => {
  const models = [
    "qwen3.7-plus",
    "qwen3.7-flash",
    "qwen3.5-plus",
    "qwen3.5-flash",
    "qwen3-coder-plus",
  ] as const;
  for (const modelId of models) {
    const result = resolveQwenOnboarding({ regionId: "cn-beijing", modelId });
    assert.equal(result.modelRef, `qwen/${modelId}`);
  }
});

test("resolveQwenOnboarding：WorkspaceId 专属域名", () => {
  const result = resolveQwenOnboarding({
    regionId: "cn-beijing",
    modelId: "qwen3-coder-plus",
    workspaceId: "ws-abc123",
  });
  assert.equal(
    result.endpoint,
    "https://ws-abc123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(result.modelRef, "qwen/qwen3-coder-plus");
});

test("resolveQwenOnboarding：非法 region/model 抛错", () => {
  assert.throws(
    () => resolveQwenOnboarding({ regionId: "unknown", modelId: "qwen3.7-plus" }),
    /qwen_region_invalid/,
  );
  assert.throws(
    () => resolveQwenOnboarding({ regionId: "cn-beijing", modelId: "qwen-plus" }),
    /qwen_model_invalid/,
  );
});

test("isAllowedQwenModelRef：允许 preset 模型，拒绝旧模型", () => {
  assert.equal(isAllowedQwenModelRef("qwen/qwen3.7-plus"), true);
  assert.equal(isAllowedQwenModelRef("qwen/qwen-plus"), false);
  assert.equal(isAllowedQwenModelRef("openai/gpt-5.5"), false);
});

test("isAllowedQwenEndpoint：Legacy 与 workspace 域名", () => {
  assert.equal(isAllowedQwenEndpoint("https://dashscope.aliyuncs.com/compatible-mode/v1"), true);
  assert.equal(
    isAllowedQwenEndpoint("https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
    true,
  );
  assert.equal(isAllowedQwenEndpoint("https://evil.example.com/v1"), false);
});

test("validateQwenOnboardingFields：组合校验", () => {
  assert.deepEqual(
    validateQwenOnboardingFields(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "qwen/qwen3.7-plus",
    ),
    { ok: true },
  );
  assert.equal(
    validateQwenOnboardingFields(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "qwen/qwen-plus",
    ).ok,
    false,
  );
});
