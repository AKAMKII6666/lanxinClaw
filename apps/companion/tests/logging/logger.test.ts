/**
 * 日志系统单元测试。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createLoggerRegistry,
  resolveLogDir,
  type LoggerRegistry,
} from "../../src/logging/logger.js";

/**
 * 创建临时日志目录。
 *
 * @returns 目录
 */
function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-log-test-"));
}

/**
 * 读取模块当前活动日志文件内容（pino-roll 命名 <module>.log.<N>，取序号最大者）。
 *
 * @param dir 日志目录
 * @param module 模块
 * @returns 文件全文
 */
function readModuleLog(dir: string, module: string): string {
  const candidates = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${module}.log`))
    .sort((a, b) => b.localeCompare(a));
  assert.ok(candidates.length > 0, `未找到 ${module}.log*`);
  return fs.readFileSync(path.join(dir, candidates[0]), "utf8");
}

test("resolveLogDir 优先级：LANXIN_LOG_DIR > userData > cwd/runtime/logs", () => {
  assert.equal(
    resolveLogDir({ LANXIN_LOG_DIR: "D:/logs" }, "C:/userData"),
    path.resolve("D:/logs"),
  );
  assert.equal(
    resolveLogDir({}, "C:/userData"),
    path.join("C:/userData", "logs"),
  );
  assert.equal(
    resolveLogDir({}, null),
    path.resolve(process.cwd(), "runtime", "logs"),
  );
});

test("logger 按模块落盘且带 module 字段", async () => {
  const dir = tempDir();
  const registry = await createLoggerRegistry({ dir, level: "debug" });
  const adapter = registry.getLogger("adapter");
  adapter.info({ jobId: "job_1" }, "delegating job");
  await registry.close();
  const raw = readModuleLog(dir, "adapter");
  const entry = JSON.parse(raw.trim().split(/\r?\n/).at(-1) ?? "{}");
  assert.equal(entry.module, "adapter");
  assert.equal(entry.jobId, "job_1");
  assert.equal(entry.msg, "delegating job");
});

test("logger redact 凭据：pairingSecret/token/apiKey 不落明文", async () => {
  const dir = tempDir();
  const registry = await createLoggerRegistry({ dir });
  registry
    .getLogger("protocol")
    .info({ pairingSecret: "super-secret", token: "tok-123", apiKey: "sk-abc" }, "sensitive");
  await registry.close();
  const raw = readModuleLog(dir, "protocol");
  assert.ok(!raw.includes("super-secret"));
  assert.ok(!raw.includes("tok-123"));
  assert.ok(!raw.includes("sk-abc"));
  assert.ok(raw.includes("[REDACTED]"));
});

test("error 级写入 error.log 聚合文件", async () => {
  const dir = tempDir();
  const registry = await createLoggerRegistry({ dir });
  registry.getLogger("bridge").error({ code: "gateway_down" }, "bridge failed");
  registry.getLogger("system").info({ ok: true }, "not error");
  await registry.close();
  const errorRaw = readModuleLog(dir, "error");
  assert.ok(errorRaw.includes("bridge failed"));
  assert.ok(!errorRaw.includes("not error"));
});

test("模块文件与日志目录可枚举", async () => {
  const dir = tempDir();
  const registry = await createLoggerRegistry({ dir });
  registry.getLogger("ui").warn("renderer warning");
  assert.equal(registry.getDir(), dir);
  await registry.close();
  const files = fs.readdirSync(dir);
  assert.ok(files.some((name) => name.startsWith("ui.log")));
});

test("registry.close 后 logger 不可再取（流已关闭）", async () => {
  const dir = tempDir();
  const registry: LoggerRegistry = await createLoggerRegistry({ dir });
  registry.getLogger("system").info("before close");
  await registry.close();
  const before = readModuleLog(dir, "system");
  assert.ok(before.includes("before close"));
  assert.throws(() => registry.getLogger("system"));
});
