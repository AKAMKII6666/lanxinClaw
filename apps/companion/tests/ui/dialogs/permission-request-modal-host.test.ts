/**
 * PermissionRequestModalHost 纯函数单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendDismissedId,
  pickPrimaryAllowDecision,
  selectActivePermissionCard,
} from "../../../src/ui/dialogs/permissions/permission-request-modal-host.js";
import type { PendingPermissionCardView } from "../../../src/permissions/views.js";
function card(id: string): PendingPermissionCardView {
  return {
    permissionRequestId: id,
    requester: "zhang-boss",
    affairId: "affair_1",
    affairTitle: "测",
    jobId: "job_1",
    reason: "goal",
    risk: "medium",
    scopeSummary: "network.access",
    denyConsequence: "job failed",
    availableDecisions: ["allow_for_job", "deny"],
  };
}

describe("permission-request-modal-host helpers", () => {
  it("selectActivePermissionCard skips dismissed ids", () => {
    const active = selectActivePermissionCard([card("a"), card("b")], ["a"]);
    assert.equal(active?.permissionRequestId, "b");
  });

  it("pickPrimaryAllowDecision prefers allow_for_job", () => {
    assert.equal(pickPrimaryAllowDecision(["allow_once", "allow_for_job", "deny"]), "allow_for_job");
    assert.equal(pickPrimaryAllowDecision(["allow_once", "deny"]), "allow_once");
    assert.equal(pickPrimaryAllowDecision(["deny"]), null);
  });

  it("appendDismissedId is idempotent", () => {
    assert.deepEqual(appendDismissedId(["a"], "b"), ["a", "b"]);
    assert.deepEqual(appendDismissedId(["a"], "a"), ["a"]);
  });
});
