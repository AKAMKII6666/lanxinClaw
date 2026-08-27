/**
 * onboarding 测试：store 加密持久化、provider 探针、两级探针状态机。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { OnboardingService } from "../../../src/onboarding/service.js";
import {
  createFileOnboardingStore,
  createMemoryOnboardingStore,
} from "../../../src/onboarding/store/store.js";
import { probeProviderKey } from "../../../src/onboarding/probe/provider-probe.js";
import type { SecretsPort } from "../../../src/onboarding/store/secrets.js";
import type { OnboardingConfig } from "../../../src/onboarding/types.js";

/** 假加密端口 */
const fakeSecrets: SecretsPort = {
  encrypt: (plain) => `enc:${plain}`,
  decrypt: (encrypted) => (encrypted.startsWith("enc:") ? encrypted.slice(4) : null),
  isAvailable: () => true,
};

const CONFIG: OnboardingConfig = {
  provider: "openai",
  apiKey: "sk-test-123",
  endpoint: null,
  modelRef: "openai/gpt-5.5",
};

/**
 * 临时替换 fetch。
 *
 * @param status 响应状态
 * @returns 恢复函数
 */
function stubFetch(status: number): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [] }), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("文件 store：apiKey 加密落盘，load 解密还原", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-onboard-"));
  const file = path.join(dir, "settings.json");
  const store = createFileOnboardingStore(file, fakeSecrets);
  store.save(CONFIG);
  const raw = fs.readFileSync(file, "utf8");
  const root = JSON.parse(raw) as { apiKeyEncrypted?: unknown; apiKey?: unknown };
  assert.equal(root.apiKeyEncrypted, "enc:sk-test-123");
  assert.equal(root.apiKey, undefined);
  const loaded = store.load();
  assert.deepEqual(loaded, CONFIG);
  store.clear();
  assert.equal(store.load(), null);
});

test("文件 store：secrets 不可用时 save 抛错", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-onboard-"));
  const unavailable: SecretsPort = {
    encrypt: () => null,
    decrypt: () => null,
    isAvailable: () => false,
  };
  const store = createFileOnboardingStore(path.join(dir, "s.json"), unavailable);
  assert.throws(() => store.save(CONFIG), /onboarding_secrets_unavailable/);
});

test("provider 探针：200 ok / 401 key_invalid / local 免 key", async () => {
  const restore1 = stubFetch(200);
  try {
    assert.equal((await probeProviderKey(CONFIG)).ok, true);
  } finally {
    restore1();
  }
  const restore2 = stubFetch(401);
  try {
    const result = await probeProviderKey(CONFIG);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "provider_key_invalid");
    }
  } finally {
    restore2();
  }
  assert.equal(
    (
      await probeProviderKey({
        provider: "local",
        apiKey: "",
        endpoint: "http://127.0.0.1:11434",
        modelRef: "local/llama",
      })
    ).ok,
    true,
  );
});

test("provider 探针：openai-compatible 缺 endpoint 拒绝", async () => {
  const result = await probeProviderKey({
    provider: "openai-compatible",
    apiKey: "k",
    endpoint: null,
    modelRef: "openai/gpt-5.5",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "provider_endpoint_missing");
  }
});

test("provider 探针：qwen 401 含地域提示", async () => {
  const restore = stubFetch(401);
  try {
    const result = await probeProviderKey({
      provider: "qwen",
      apiKey: "sk-qwen",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelRef: "qwen/qwen3.7-plus",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "provider_key_invalid");
      assert.match(result.message, /地域/);
    }
  } finally {
    restore();
  }
});

test("provider 探针：qwen 200 ok", async () => {
  const restore = stubFetch(200);
  try {
    const result = await probeProviderKey({
      provider: "qwen",
      apiKey: "sk-qwen",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelRef: "qwen/qwen3.7-plus",
    });
    assert.equal(result.ok, true);
  } finally {
    restore();
  }
});

test("provider 探针：qwen 缺 endpoint 拒绝", async () => {
  const result = await probeProviderKey({
    provider: "qwen",
    apiKey: "sk-qwen",
    endpoint: null,
    modelRef: "qwen/qwen3.7-plus",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "provider_endpoint_missing");
  }
});

test("service：提交成功进入 ready；失败保留原因；clear 回 unconfigured", async () => {
  const service = new OnboardingService({
    store: createMemoryOnboardingStore(fakeSecrets),
    runtimeReadyProbe: async () => ({ ok: true }),
  });
  assert.equal(service.getStatus(), "unconfigured");

  const restore = stubFetch(200);
  try {
    const result = await service.submitConfig(CONFIG);
    assert.equal(result.ok, true);
  } finally {
    restore();
  }
  assert.equal(service.getStatus(), "ready");

  service.clear();
  assert.equal(service.getStatus(), "unconfigured");
});

test("service：key 探针失败 → failed + lastError，主界面不可达", async () => {
  const service = new OnboardingService({
    store: createMemoryOnboardingStore(fakeSecrets),
    runtimeReadyProbe: async () => ({ ok: true }),
  });
  const restore = stubFetch(401);
  try {
    const result = await service.submitConfig(CONFIG);
    assert.equal(result.ok, false);
  } finally {
    restore();
  }
  assert.equal(service.getStatus(), "failed");
  assert.equal(service.getLastError()?.code, "provider_key_invalid");
});

test("service：运行时就绪探针失败 → failed", async () => {
  const service = new OnboardingService({
    store: createMemoryOnboardingStore(fakeSecrets),
    runtimeReadyProbe: async () => ({
      ok: false,
      code: "gateway_startup_timeout",
      message: "gateway 未就绪",
    }),
  });
  const restore = stubFetch(200);
  try {
    const result = await service.submitConfig(CONFIG);
    assert.equal(result.ok, false);
  } finally {
    restore();
  }
  assert.equal(service.getStatus(), "failed");
  assert.equal(service.getLastError()?.code, "gateway_startup_timeout");
});

test("service：运行时探针抛错时返回结构化失败，不让 IPC 变成主进程未响应", async () => {
  const service = new OnboardingService({
    store: createMemoryOnboardingStore(fakeSecrets),
    runtimeReadyProbe: async () => {
      throw new Error("gateway_exited_before_ready?token=abc&api_key=sk-test-secret");
    },
  });
  const restore = stubFetch(200);
  try {
    const result = await service.submitConfig(CONFIG);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "runtime_probe_failed");
      assert.equal(result.message.includes("sk-test-secret"), false);
      assert.equal(result.message.includes("api_key=***"), true);
    }
  } finally {
    restore();
  }
  assert.equal(service.getStatus(), "failed");
  assert.equal(service.getLastError()?.code, "runtime_probe_failed");
});

test("service：submitConfig 阶段顺序 verifying_key → starting_runtime", async () => {
  const phases: string[] = [];
  const service = new OnboardingService({
    store: createMemoryOnboardingStore(fakeSecrets),
    runtimeReadyProbe: async () => {
      phases.push("runtime_probe");
      return { ok: true };
    },
  });
  const restore = stubFetch(200);
  try {
    await service.submitConfig(CONFIG, {
      onPhase: (phase) => phases.push(phase),
    });
  } finally {
    restore();
  }
  assert.deepEqual(phases, ["verifying_key", "starting_runtime", "runtime_probe"]);
});

test("service：bootstrapRuntime 失败保留配置且不进入主界面语义", async () => {
  const store = createMemoryOnboardingStore(fakeSecrets);
  store.save(CONFIG);
  const service = new OnboardingService({
    store,
    runtimeReadyProbe: async () => ({
      ok: false,
      code: "gateway_startup_timeout",
      message: "gateway 未就绪",
    }),
  });
  assert.equal(service.getStatus(), "ready");
  const phases: string[] = [];
  const result = await service.bootstrapRuntime({
    onPhase: (phase) => phases.push(phase),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(phases, ["starting_runtime"]);
  assert.equal(service.getStatus(), "ready");
  assert.equal(service.getLastError()?.code, "gateway_startup_timeout");
  assert.ok(store.load());
});
