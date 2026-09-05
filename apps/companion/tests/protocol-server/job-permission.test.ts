/**
 * job-permission 校验单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validatePermissions } from "../../src/protocol-server/job-permission.js";

describe("validatePermissions", () => {
  it("rejects unknown permission ids without silent strip", () => {
    const mixed = validatePermissions(["workspace.read", "desktop.access"]);
    assert.equal(mixed.ok, false);
    if (!mixed.ok) {
      assert.equal(mixed.code, "unknown_permission_ids");
    }
  });

  it("rejects empty list", () => {
    const empty = validatePermissions([]);
    assert.equal(empty.ok, false);
    if (!empty.ok) {
      assert.equal(empty.code, "job_permissions_required");
    }
  });

  it("accepts known permissions", () => {
    const ok = validatePermissions(["workspace.read", "network.access"]);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.deepEqual(ok.permissions, ["workspace.read", "network.access"]);
    }
  });
});
