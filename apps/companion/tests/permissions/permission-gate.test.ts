/**
 * Permission gate 与默认策略单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  effectOfPermissionDecision,
  validatePayloadForType,
} from "@lanxin-claw/protocol";
import { classifyPermissionPolicy } from "../../src/permissions/gate/policy/default-policy.js";
import { createDemoPermissionGate } from "../../src/permissions/gate/demo/create-demo-gate.js";
import { PermissionGate } from "../../src/permissions/gate/permission-gate.js";

describe("permission gate", () => {
  it("默认策略：执行权限 needs_confirm，secrets 默认拒绝，元能力 default_allow", () => {
    assert.equal(classifyPermissionPolicy("workspace.read"), "needs_confirm");
    assert.equal(classifyPermissionPolicy("workspace.write"), "needs_confirm");
    assert.equal(classifyPermissionPolicy("command.run"), "needs_confirm");
    assert.equal(classifyPermissionPolicy("network.access"), "needs_confirm");
    assert.equal(classifyPermissionPolicy("git.read"), "needs_confirm");
    assert.equal(classifyPermissionPolicy("git.write"), "needs_confirm");
    assert.equal(classifyPermissionPolicy("desktop.control"), "needs_confirm");
    assert.equal(classifyPermissionPolicy("secrets.read"), "default_deny");
    assert.equal(classifyPermissionPolicy("connection.status"), "default_allow");
  });

  it("pending 执行权限进入用户待确认卡片列表", () => {
    const gate = new PermissionGate();
    gate.enqueue({
      permissionRequestId: "perm_ws",
      jobId: "job_ws",
      affairId: null,
      requester: "zhang-boss",
      requestedPermissions: ["workspace.read"],
      reason: "读盘",
      risk: "low",
      proposedScope: {},
      denyConsequence: "停",
      requestedAt: "2026-07-23T00:00:00.000Z",
      expiresAt: null,
    });
    assert.equal(gate.listPendingCards().length, 1);
    assert.equal(gate.hasPendingForJob("job_ws"), true);
  });

  it("allow_once 授予后首次 check 消耗；deny 保持阻断", () => {
    const gate = createDemoPermissionGate();
    const allow = gate.decide("perm_req_001", "allow_once", "2026-07-23T01:10:00.000Z");
    assert.equal(allow.ok, true);
    assert.equal(allow.actionBlocked, false);
    assert.equal(gate.hasGrant("job_fix_code_001", "workspace.read"), true);
    assert.equal(gate.isGranted("job_fix_code_001", "workspace.read"), true);
    assert.equal(gate.isGranted("job_fix_code_001", "workspace.read"), false);
    assert.equal(gate.listPendingCards().length, 0);

    const gate2 = new PermissionGate();
    gate2.enqueue({
      permissionRequestId: "perm_req_deny",
      jobId: "job_2",
      affairId: null,
      requester: "openclaw-adapter",
      requestedPermissions: ["command.run"],
      reason: "跑测试",
      risk: "low",
      proposedScope: { commands: ["npm test"] },
      denyConsequence: "job 停在 needs_permission",
      requestedAt: "2026-07-23T01:00:00.000Z",
      expiresAt: null,
    });
    const denied = gate2.decide("perm_req_deny", "deny");
    assert.equal(denied.ok, true);
    assert.equal(denied.actionBlocked, true);
    assert.equal(gate2.hasGrant("job_2", "command.run"), false);
    assert.equal(gate2.isGranted("job_2", "command.run"), false);
  });

  it("allow_for_job 在 job 范围内可重复；require_more_context 需澄清", () => {
    const gate = createDemoPermissionGate();
    const forJob = gate.decide("perm_req_001", "allow_for_job");
    assert.equal(forJob.ok, true);
    assert.equal(gate.isGranted("job_fix_code_001", "workspace.read"), true);
    assert.equal(gate.isGranted("job_fix_code_001", "workspace.read"), true);

    const gate2 = createDemoPermissionGate();
    const clarify = gate2.decide("perm_req_001", "require_more_context");
    assert.equal(clarify.ok, true);
    assert.equal(clarify.needsClarification, true);
    assert.equal(clarify.actionBlocked, true);
    assert.equal(effectOfPermissionDecision("require_more_context"), "request_clarification");
  });

  it("未知决策按 deny；decision payload 可通过协议校验", () => {
    const gate = createDemoPermissionGate();
    const result = gate.decide("perm_req_001", "not_a_real_decision");
    assert.equal(result.ok, true);
    assert.equal(result.decision, "deny");
    assert.equal(result.actionBlocked, true);
    const payload = gate.toDecisionPayload(result, "perm_req_001", "job_fix_code_001");
    assert.ok(payload);
    assert.equal(validatePayloadForType("permission.decision", payload).ok, true);
  });
});
