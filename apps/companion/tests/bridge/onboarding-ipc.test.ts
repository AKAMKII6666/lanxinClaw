/**
 * onboarding IPC 通道测试。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOnboardingPayload } from "../../src/bridge/onboarding-payload.js";
import type { OnboardingIpcPort } from "../../src/bridge/register-ipc.js";

test("onboarding 载荷校验：合法通过、未知 provider 拒绝", () => {
  const ok = normalizeOnboardingPayload({
    provider: "openai",
    apiKey: "sk-1",
    endpoint: "https://x",
    modelRef: "openai/gpt-5.5",
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.provider, "openai");
    assert.equal(ok.value.endpoint, "https://x");
  }

  const qwenOk = normalizeOnboardingPayload({
    provider: "qwen",
    apiKey: "sk-qwen",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelRef: "qwen/qwen3.7-plus",
  });
  assert.ok(qwenOk.ok);
  if (qwenOk.ok) {
    assert.equal(qwenOk.value.provider, "qwen");
    assert.equal(qwenOk.value.modelRef, "qwen/qwen3.7-plus");
  }

  const qwenMissingEndpoint = normalizeOnboardingPayload({
    provider: "qwen",
    apiKey: "sk-qwen",
    modelRef: "qwen/qwen3.7-plus",
  });
  assert.ok(!qwenMissingEndpoint.ok);
  if (!qwenMissingEndpoint.ok) {
    assert.match(qwenMissingEndpoint.error.message, /端点/);
  }

  const badProvider = normalizeOnboardingPayload({
    provider: "unknown",
    apiKey: "sk-1",
    modelRef: "x/y",
  });
  assert.ok(!badProvider.ok);

  const missingModel = normalizeOnboardingPayload({
    provider: "openai",
    apiKey: "sk-1",
    modelRef: "  ",
  });
  assert.ok(!missingModel.ok);

  const missingKey = normalizeOnboardingPayload({
    provider: "openai",
    modelRef: "x/y",
  });
  assert.ok(!missingKey.ok);
});

test("onboarding 载荷校验：qwen preset 拒绝旧模型与非法 endpoint", () => {
  const oldModel = normalizeOnboardingPayload({
    provider: "qwen",
    apiKey: "sk-qwen",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelRef: "qwen/qwen-plus",
  });
  assert.ok(!oldModel.ok);

  const badEndpoint = normalizeOnboardingPayload({
    provider: "qwen",
    apiKey: "sk-qwen",
    endpoint: "https://evil.example.com/v1",
    modelRef: "qwen/qwen3.7-plus",
  });
  assert.ok(!badEndpoint.ok);

  const emptyKey = normalizeOnboardingPayload({
    provider: "qwen",
    apiKey: "  ",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelRef: "qwen/qwen3.7-plus",
  });
  assert.ok(!emptyKey.ok);
});

test("OnboardingIpcPort 契约形状", () => {
  const port: OnboardingIpcPort = {
    getStatus: () => ({ status: "unconfigured", lastError: null }),
    submit: async () => ({
      ok: true,
      status: { status: "ready", lastError: null },
    }),
    bootstrapRuntime: async () => ({
      ok: true,
      status: { status: "ready", lastError: null },
    }),
    clear: () => ({ status: "unconfigured", lastError: null }),
  };
  assert.equal(port.getStatus().status, "unconfigured");
});
