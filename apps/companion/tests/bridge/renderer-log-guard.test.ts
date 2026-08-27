/**
 * renderer 日志通道白名单测试。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRendererLogEntry } from "../../src/bridge/guards/renderer-log-guard.js";

test("合法 ui 日志通过", () => {
  const result = validateRendererLogEntry({
    module: "ui",
    level: "warn",
    message: "渲染失败，重试",
    meta: { page: "tasks", retries: 2 },
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.module, "ui");
    assert.equal(result.value.level, "warn");
  }
});

test("非 ui 模块拒绝", () => {
  const result = validateRendererLogEntry({
    module: "adapter",
    level: "info",
    message: "伪造 adapter 日志",
  });
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.equal(result.error.code, "bridge_log_module_rejected");
  }
});

test("非法 level 拒绝", () => {
  const result = validateRendererLogEntry({
    module: "ui",
    level: "fatal",
    message: "bad level",
  });
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.equal(result.error.code, "bridge_log_level_rejected");
  }
});

test("空 message 拒绝", () => {
  const result = validateRendererLogEntry({
    module: "ui",
    level: "info",
    message: "   ",
  });
  assert.ok(!result.ok);
});

test("超长 message 拒绝", () => {
  const result = validateRendererLogEntry({
    module: "ui",
    level: "info",
    message: "x".repeat(2001),
  });
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.equal(result.error.code, "bridge_log_too_long");
  }
});

test("meta 深度超限拒绝", () => {
  const deep = { a: { b: { c: { d: { e: 1 } } } } };
  const result = validateRendererLogEntry({
    module: "ui",
    level: "info",
    message: "deep meta",
    meta: deep,
  });
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.equal(result.error.code, "bridge_log_meta_too_deep");
  }
});

test("meta 含凭据键值仍通过（落盘时由 pino redact 处理）", () => {
  const result = validateRendererLogEntry({
    module: "ui",
    level: "error",
    message: "error with secret",
    meta: { apiKey: "sk-abc" },
  });
  assert.ok(result.ok);
});
