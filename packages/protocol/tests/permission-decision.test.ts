/**
 * 协议权限决策枚举单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectOfPermissionDecision,
  isPermissionDecision,
  PERMISSION_DECISIONS,
} from "../src/index.js";

describe("permission decision states", () => {
  it("四类决策均合法，未知按 deny 效果", () => {
    assert.equal(PERMISSION_DECISIONS.length, 4);
    assert.equal(isPermissionDecision("allow_once"), true);
    assert.equal(isPermissionDecision("allow_for_job"), true);
    assert.equal(isPermissionDecision("deny"), true);
    assert.equal(isPermissionDecision("require_more_context"), true);
    assert.equal(isPermissionDecision("grant_forever"), false);
    assert.equal(effectOfPermissionDecision("allow_once"), "grant_once");
    assert.equal(effectOfPermissionDecision("allow_for_job"), "grant_for_job");
    assert.equal(effectOfPermissionDecision("deny"), "deny_action");
    assert.equal(effectOfPermissionDecision("require_more_context"), "request_clarification");
    assert.equal(effectOfPermissionDecision("grant_forever"), "deny_action");
  });
});
