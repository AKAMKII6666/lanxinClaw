/**
 * 工作区范围校验单测。
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { isPathInsideOrEqual, resolveAuthorizedWorkspaceRoot } from "../../../src/jobs/workspace-scope.js";

test("isPathInsideOrEqual：根自身与子路径通过，越界拒绝", () => {
  const root = path.resolve("F:/ws");
  assert.equal(isPathInsideOrEqual(root, root), true);
  assert.equal(isPathInsideOrEqual(root, path.join(root, "src")), true);
  assert.equal(isPathInsideOrEqual(root, path.resolve("F:/other")), false);
});

test("resolveAuthorizedWorkspaceRoot：无授权根时允许 runHint", () => {
  const ok = resolveAuthorizedWorkspaceRoot(null, "F:/any");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.workspaceRoot, "F:/any");
  }
});

test("resolveAuthorizedWorkspaceRoot：越界返回 workspace_scope_mismatch", () => {
  const bad = resolveAuthorizedWorkspaceRoot("F:/ws", "F:/other");
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.code, "workspace_scope_mismatch");
  }
});
