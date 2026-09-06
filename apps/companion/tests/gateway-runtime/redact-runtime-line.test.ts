/**
 * OpenClaw 运行时行日志脱敏单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { redactOpenClawRuntimeLine } from "../../src/gateway-runtime/redact-runtime-line.js";

test("脱敏 sk / Bearer / apiKey 赋值", () => {
  const line = redactOpenClawRuntimeLine(
    "auth apiKey=sk-abcdefghijklmnop Bearer eyJhbGciOiJIUzI1NiJ9.payload BRAVE_API_KEY=secret123",
  );
  assert.ok(!line.includes("sk-abcdefghijklmnop"));
  assert.ok(!line.includes("eyJhbGciOiJIUzI1NiJ9.payload"));
  assert.ok(!line.includes("secret123"));
  assert.ok(line.includes("apiKey=***") || line.includes("sk-***"));
  assert.ok(line.includes("Bearer ***"));
  assert.ok(line.includes("BRAVE_API_KEY=***"));
});
