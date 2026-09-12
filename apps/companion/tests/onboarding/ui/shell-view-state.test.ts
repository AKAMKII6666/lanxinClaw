/**
 * shell-view-state 纯函数测试。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  viewAfterBootstrap,
  viewAfterBootstrapThrow,
} from "../../../src/ui/app/boot/shell-view-state.js";

test("viewAfterBootstrap: ok to main, fail keeps bootstrap error", () => {
  assert.deepEqual(viewAfterBootstrap({ ok: true, status: { status: "ready", lastError: null } }), {
    kind: "main",
  });
  const failed = viewAfterBootstrap({
    ok: false,
    error: { code: "x", message: "boom", retryable: true },
    status: { status: "ready", lastError: null },
  });
  assert.equal(failed.kind, "bootstrap");
  if (failed.kind === "bootstrap") {
    assert.equal(failed.error, "boom");
  }
});

test("viewAfterBootstrapThrow: main process unavailable message", () => {
  const view = viewAfterBootstrapThrow();
  assert.equal(view.kind, "bootstrap");
  if (view.kind === "bootstrap") {
    assert.match(view.error ?? "", /Companion/);
  }
});
