/**
 * 自托管 gateway 进程管理器测试。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_STARTUP_TIMEOUT_MS,
  findFreePort,
  GatewayRuntimeManager,
} from "../../src/gateway-runtime/manager.js";

/**
 * 写一个假 gateway 脚本：按 env 端口监听，并在 stdout 打印 stateDir。
 *
 * @returns 脚本路径
 */
function writeFakeGateway(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-test-"));
  const file = path.join(dir, "fake-gateway.js");
  fs.writeFileSync(
    file,
    `
const net = require("node:net");
const port = Number(process.env.OPENCLAW_GATEWAY_PORT);
const server = net.createServer((socket) => socket.end());
server.listen(port, "127.0.0.1", () => {
  console.log("ready:" + process.env.OPENCLAW_STATE_DIR);
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
`,
    "utf8",
  );
  return file;
}

test("findFreePort 返回可监听端口", async () => {
  const port = await findFreePort();
  assert.ok(port > 0);
});

test("启动假 gateway：端口就绪、环境变量隔离、可停止", async () => {
  const entry = writeFakeGateway();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-state-"));
  const stdoutLines: string[] = [];
  const manager = new GatewayRuntimeManager({
    openclawEntry: entry,
    stateDir,
    token: "local-token",
    onStdout: (line) => stdoutLines.push(line),
    startupTimeoutMs: 5_000,
  });

  const handle = await manager.start();
  assert.ok(handle.port > 0);
  assert.equal(handle.url, `ws://127.0.0.1:${handle.port}`);
  assert.equal(manager.isRunning(), true);
  assert.equal(stdoutLines.some((line) => line === `ready:${stateDir}`), true);

  await handle.stop();
  assert.equal(manager.isRunning(), false);
});

test("子进程提前退出时 start 抛错", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-exit-"));
  const entry = path.join(dir, "exit-gateway.js");
  fs.writeFileSync(entry, "console.error('boom'); process.exit(1);", "utf8");
  const manager = new GatewayRuntimeManager({
    openclawEntry: entry,
    stateDir: dir,
    token: "t",
    startupTimeoutMs: 1_000,
  });
  await assert.rejects(() => manager.start(), /gateway_startup_timeout|gateway_exited_before_ready/);
  assert.equal(manager.isRunning(), false);
});

test("DEFAULT_STARTUP_TIMEOUT_MS 覆盖冷启动余量", () => {
  assert.equal(DEFAULT_STARTUP_TIMEOUT_MS, 300_000);
});

test("仅 TCP 可连但无 ready 日志时不视为就绪", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-early-tcp-"));
  const entry = path.join(dir, "early-tcp-gateway.js");
  fs.writeFileSync(
    entry,
    `
const net = require("node:net");
const port = Number(process.env.OPENCLAW_GATEWAY_PORT);
const server = net.createServer((socket) => socket.end());
server.listen(port, "127.0.0.1", () => {
  console.log("listening-only-no-ready-marker");
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
`,
    "utf8",
  );
  const manager = new GatewayRuntimeManager({
    openclawEntry: entry,
    stateDir: dir,
    token: "t",
    startupTimeoutMs: 1_200,
  });
  await assert.rejects(() => manager.start(), /gateway_startup_timeout/);
  assert.equal(manager.isRunning(), false);
});

test("启动超时后 stop 子进程，不留孤儿", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-gw-slow-"));
  const entry = path.join(dir, "slow-gateway.js");
  fs.writeFileSync(
    entry,
    `
setInterval(() => {}, 60_000);
process.on("SIGTERM", () => process.exit(0));
`,
    "utf8",
  );
  const manager = new GatewayRuntimeManager({
    openclawEntry: entry,
    stateDir: dir,
    token: "t",
    startupTimeoutMs: 800,
  });
  await assert.rejects(() => manager.start(), /gateway_startup_timeout/);
  assert.equal(manager.isRunning(), false);
});
