/**
 * openclaw.json 生成测试。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateOpenClawConfig,
  OPENCLAW_MODEL_KEY_ENV,
  providerMeta,
} from "../../src/gateway-runtime/openclaw-config.js";

test("生成配置：gateway token/port、模型 env ref、logging.file", () => {
  const text = generateOpenClawConfig({
    token: "local-token",
    port: 19387,
    modelRef: "openai/gpt-5.5",
    providerId: "openai",
    withApiKey: true,
    baseUrl: null,
    workspace: "C:/ws",
    logFile: "C:/logs/openclaw.log",
  });
  const config = JSON.parse(text) as {
    gateway?: { port?: number; auth?: { token?: string } };
    agents?: { defaults?: { model?: string; workspace?: string } };
    models?: { providers?: Record<string, { apiKey?: { source?: string; id?: string } }> };
    logging?: { file?: string };
  };
  assert.equal(config.gateway?.port, 19387);
  assert.equal(config.gateway?.auth?.token, "local-token");
  assert.equal(config.agents?.defaults?.model, "openai/gpt-5.5");
  assert.equal(config.agents?.defaults?.workspace, "C:/ws");
  assert.equal(config.logging?.file, "C:/logs/openclaw.log");
  const openai = config.models?.providers?.openai;
  assert.equal(openai?.apiKey?.source, "env");
  assert.equal(openai?.apiKey?.id, OPENCLAW_MODEL_KEY_ENV);
  assert.ok(!text.includes("sk-"));
});

test("生成配置：qwen provider 含 baseUrl 与 model", () => {
  const dashscopeUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const text = generateOpenClawConfig({
    token: "local-token",
    port: 19387,
    modelRef: "qwen/qwen3.7-plus",
    providerId: "qwen",
    withApiKey: true,
    baseUrl: dashscopeUrl,
    workspace: "C:/ws",
    logFile: "C:/logs/openclaw.log",
  });
  const config = JSON.parse(text) as {
    agents?: { defaults?: { model?: string } };
    models?: { providers?: Record<string, { baseUrl?: string; apiKey?: { id?: string } }> };
  };
  assert.equal(config.agents?.defaults?.model, "qwen/qwen3.7-plus");
  assert.equal(config.models?.providers?.qwen?.baseUrl, dashscopeUrl);
  assert.equal(config.models?.providers?.qwen?.apiKey?.id, OPENCLAW_MODEL_KEY_ENV);
  assert.ok(!text.includes("sk-"));
});

test("providerMeta 映射 provider → providerId/needsKey/baseUrl", () => {
  assert.deepEqual(providerMeta("openai", null), {
    providerId: "openai",
    needsKey: true,
    baseUrl: null,
  });
  assert.deepEqual(
    providerMeta(
      "qwen",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "qwen/qwen3.7-plus",
    ),
    {
      providerId: "qwen",
      needsKey: true,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  );
  assert.deepEqual(providerMeta("openai-compatible", "http://127.0.0.1:8080/v1", "qwen/qwen-plus"), {
    providerId: "qwen",
    needsKey: true,
    baseUrl: "http://127.0.0.1:8080/v1",
  });
  assert.deepEqual(providerMeta("local", "http://127.0.0.1:11434/v1", "ollama/qwen3"), {
    providerId: "ollama",
    needsKey: false,
    baseUrl: "http://127.0.0.1:11434/v1",
  });
});
