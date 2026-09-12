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

test("生成配置：可选 web/browser tools，不含密钥明文", () => {
  const text = generateOpenClawConfig({
    token: "local-token",
    port: 19387,
    modelRef: "openai/gpt-5.5",
    providerId: "openai",
    withApiKey: true,
    baseUrl: null,
    workspace: "C:/ws",
    logFile: "C:/logs/openclaw.log",
    webTools: {
      enableWebSearch: true,
      enableBrowser: true,
      withWebSearchApiKey: true,
    },
  });
  const config = JSON.parse(text) as {
    tools?: { web?: { search?: { enabled?: boolean; provider?: string; apiKey?: string } }; alsoAllow?: string[] };
    browser?: { enabled?: boolean };
  };
  assert.equal(config.tools?.web?.search?.enabled, true);
  assert.equal(config.tools?.web?.search?.provider, "brave");
  assert.equal(config.tools?.web?.search?.apiKey, undefined);
  assert.ok(config.tools?.alsoAllow?.includes("browser"));
  assert.equal(config.browser?.enabled, true);
  assert.ok(!text.includes("sk-"));
  assert.ok(!text.toLowerCase().includes("brave_api_key=secret"));
});

test("默认写入 browser；未显式开 web_search", () => {
  const text = generateOpenClawConfig({
    token: "local-token",
    port: 19387,
    modelRef: "openai/gpt-5.5",
    providerId: "openai",
    withApiKey: true,
    workspace: "C:/ws",
    logFile: "C:/logs/openclaw.log",
  });
  const config = JSON.parse(text) as {
    tools?: { alsoAllow?: string[]; web?: unknown };
    browser?: { enabled?: boolean; headless?: boolean; extraArgs?: string[] };
  };
  assert.equal(config.browser?.enabled, true);
  assert.equal(config.browser?.headless, false);
  assert.equal(config.browser?.extraArgs, undefined);
  assert.equal(
    (config.browser as { ssrfPolicy?: unknown } | undefined)?.ssrfPolicy,
    undefined,
  );
  assert.ok(config.tools?.alsoAllow?.includes("browser"));
  assert.equal(config.tools?.web, undefined);
});

test("开启浏览器本地代理时写入 browser 私网 SSRF + fetch fake-IP 合法字段；关闭不残留", () => {
  const onText = generateOpenClawConfig({
    token: "local-token",
    port: 19387,
    modelRef: "openai/gpt-5.5",
    providerId: "openai",
    withApiKey: true,
    workspace: "C:/ws",
    logFile: "C:/logs/openclaw.log",
    webTools: {
      enableWebSearch: false,
      enableBrowser: true,
      browserProxyEnabled: true,
      browserProxyUrl: "http://127.0.0.1:7890",
    },
  });
  const onConfig = JSON.parse(onText) as {
    browser?: {
      extraArgs?: string[];
      ssrfPolicy?: { dangerouslyAllowPrivateNetwork?: boolean };
    };
    tools?: {
      web?: {
        fetch?: {
          useTrustedEnvProxy?: boolean;
          ssrfPolicy?: {
            allowRfc2544BenchmarkRange?: boolean;
            allowIpv6UniqueLocalRange?: boolean;
            dangerouslyAllowPrivateNetwork?: boolean;
          };
        };
      };
    };
  };
  assert.deepEqual(onConfig.browser?.extraArgs, ["--proxy-server=http://127.0.0.1:7890"]);
  assert.equal(onConfig.browser?.ssrfPolicy?.dangerouslyAllowPrivateNetwork, true);
  assert.equal(onConfig.tools?.web?.fetch?.useTrustedEnvProxy, true);
  assert.equal(onConfig.tools?.web?.fetch?.ssrfPolicy?.allowRfc2544BenchmarkRange, true);
  assert.equal(onConfig.tools?.web?.fetch?.ssrfPolicy?.allowIpv6UniqueLocalRange, true);
  assert.equal(onConfig.tools?.web?.fetch?.ssrfPolicy?.dangerouslyAllowPrivateNetwork, undefined);

  const offText = generateOpenClawConfig({
    token: "local-token",
    port: 19387,
    modelRef: "openai/gpt-5.5",
    providerId: "openai",
    withApiKey: true,
    workspace: "C:/ws",
    logFile: "C:/logs/openclaw.log",
    webTools: {
      enableWebSearch: false,
      enableBrowser: true,
      browserProxyEnabled: false,
      browserProxyUrl: "http://127.0.0.1:7890",
    },
  });
  const offConfig = JSON.parse(offText) as {
    browser?: {
      extraArgs?: string[];
      ssrfPolicy?: { dangerouslyAllowPrivateNetwork?: boolean };
    };
    tools?: { web?: unknown };
  };
  assert.equal(offConfig.browser?.extraArgs, undefined);
  assert.equal(offConfig.browser?.ssrfPolicy, undefined);
  assert.equal(offConfig.tools?.web, undefined);
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
