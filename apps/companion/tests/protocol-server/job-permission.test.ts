/**
 * job-permission 校验单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../src/backend/runtime.js";
import {
  enqueueJobPermission,
  validatePermissions,
} from "../../src/protocol-server/job-permission.js";

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

describe("enqueueJobPermission research enrich", () => {
  it("查价 goal 仅 network.access 时 permission 请求含 desktop.control", () => {
    const backend = createCompanionBackendRuntime();
    const envelope = createEnvelope({
      source: { kind: "phone", deviceId: "phone_1" },
      target: { kind: "companion", deviceId: "desk_1" },
      type: "job.create",
      payload: {
        jobId: "job_price_1",
        affairId: "affair_price_1",
        executor: "openclaw",
        status: "queued",
        goal: "查询BNB当前价格",
        workspaceHint: null,
        allowedPermissions: ["network.access"],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      },
    });
    const queued = enqueueJobPermission({ backend } as never, envelope);
    assert.equal(queued.ok, true);
    if (!queued.ok) {
      return;
    }
    assert.ok(queued.request.requestedPermissions.includes("desktop.control"));
    assert.ok(queued.request.requestedPermissions.includes("network.access"));
    assert.equal(queued.request.risk, "high");
  });
});
