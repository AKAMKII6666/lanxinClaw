/**
 * gateway 运行时服务测试：写配置、启动假 gateway、幂等、停止。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GatewayRuntimeService } from "../../src/gateway-runtime/service.js";

/**
 * 写一个假 gateway 脚本：响应协议 v4 握手与 agent 方法。
 *
 * @returns 脚本路径
 */
function writeFakeGateway(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-svc-"));
  const file = path.join(dir, "fake-gateway.js");
  fs.writeFileSync(
    file,
    `
const net = require("node:net");
const port = Number(process.env.OPENCLAW_GATEWAY_PORT);
const server = net.createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      if (frame.type === "req") {
        let payload = {};
        if (frame.method === "connect") payload = { type: "hello-ok", protocol: 4, server: { version: "x", connId: "c" } };
        if (frame.method === "agent") payload = { runId: frame.params.idempotencyKey || "run-1", status: "accepted" };
        if (frame.method === "agent.wait") payload = { runId: frame.params.runId, status: "completed" };
        socket.write(JSON.stringify({ type: "res", id: frame.id, ok: true, payload }) + "\\n");
      }
    }
  });
});
server.listen(port, "127.0.0.1", () => {
  console.log("ready:fake");
});
process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
`,
    "utf8",
  );
  return file;
}

test("ensureStarted：写 config（env ref 不含明文 key）、启动、幂等、停止", async () => {
  const entry = writeFakeGateway();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-state-"));
  const service = new GatewayRuntimeService({
    openclawEntry: entry,
    stateDir,
    restartDelayMs: 50,
    startupTimeoutMs: 1_000,
  });

  const handle = await service.ensureStarted({
    provider: "openai",
    apiKey: "sk-secret-key",
    endpoint: null,
    modelRef: "openai/gpt-5.5",
    workspace: path.join(stateDir, "workspace"),
  });
  assert.ok(handle.url.startsWith("ws://127.0.0.1:"));
  assert.ok(handle.token.length > 0);
  assert.equal(service.isRunning(), true);

  const configText = fs.readFileSync(path.join(stateDir, "openclaw.json"), "utf8");
  assert.ok(!configText.includes("sk-secret-key"));
  assert.ok(configText.includes("source"));
  assert.ok(configText.includes("loopback"));

  const same = await service.ensureStarted({
    provider: "openai",
    apiKey: "sk-secret-key",
    endpoint: null,
    modelRef: "openai/gpt-5.5",
    workspace: path.join(stateDir, "workspace"),
  });
  assert.equal(same, handle, "幂等：重复 ensureStarted 返回同一句柄");

  await handle.stop();
  assert.equal(service.isRunning(), false);
  assert.equal(service.getHandle(), null);
});

test("ensureStarted：qwen 写入 openclaw.json providers.qwen.baseUrl", async () => {
  const entry = writeFakeGateway();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-qwen-"));
  const service = new GatewayRuntimeService({
    openclawEntry: entry,
    stateDir,
    restartDelayMs: 50,
    startupTimeoutMs: 1_000,
  });
  const dashscopeUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";

  await service.ensureStarted({
    provider: "qwen",
    apiKey: "sk-test-qwen",
    endpoint: dashscopeUrl,
    modelRef: "qwen/qwen3.7-plus",
    workspace: path.join(stateDir, "workspace"),
  });

  const config = JSON.parse(fs.readFileSync(path.join(stateDir, "openclaw.json"), "utf8")) as {
    agents?: { defaults?: { model?: string } };
    models?: { providers?: { qwen?: { baseUrl?: string } } };
  };
  assert.equal(config.agents?.defaults?.model, "qwen/qwen3.7-plus");
  assert.equal(config.models?.providers?.qwen?.baseUrl, dashscopeUrl);

  await service.stop();
});

test("首次启动失败不后台重试，避免配置错误时刷屏", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-restart-"));
  const countFile = path.join(dir, "launch-count.txt");
  const entry = path.join(dir, "flaky-gateway.js");
  fs.writeFileSync(
    entry,
    `
const fs = require("node:fs");
const countFile = ${JSON.stringify(countFile)};
const count = Number(fs.existsSync(countFile) ? fs.readFileSync(countFile, "utf8") : "0") + 1;
fs.writeFileSync(countFile, String(count));
if (count === 1) {
  console.error("first launch crash");
  process.exit(1);
}
const net = require("node:net");
const port = Number(process.env.OPENCLAW_GATEWAY_PORT);
const server = net.createServer((socket) => socket.end());
server.listen(port, "127.0.0.1", () => {
  console.log("ready:fake");
});
process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
`,
    "utf8",
  );
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-state-"));
  const service = new GatewayRuntimeService({
    openclawEntry: entry,
    stateDir,
    restartDelayMs: 50,
    startupTimeoutMs: 1_000,
  });

  await assert.rejects(
    () =>
      service.ensureStarted({
        provider: "openai",
        apiKey: "sk-x",
        endpoint: null,
        modelRef: "openai/gpt-5.5",
        workspace: stateDir,
      }),
    /gateway_startup_timeout|gateway_exited_before_ready/,
  );

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(service.isRunning(), false, "首次失败不应后台自动重启");
  const count = Number(fs.readFileSync(countFile, "utf8"));
  assert.equal(count, 1);
  await service.stop();
  assert.equal(service.isRunning(), false);
});
