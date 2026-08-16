/**
 * Companion backend runtime 测试。
 *
 * 职责：验证协议事件进入真实 store 后可投影 snapshot，且状态机 fail-closed。
 * 不拥有：WebSocket server、真实 OpenClaw Gateway、renderer UI。
 * 副作用：仅内存。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../src/backend/runtime.js";

describe("companion backend runtime", () => {
  it("affair/job 事件进入 store 后更新 snapshot，completed 只到 waiting_acceptance", () => {
    const backend = createCompanionBackendRuntime();
    const affair = createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_backend_001",
        title: "修复项目问题",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: ["测试通过"],
        currentJobId: "job_backend_001",
      },
    });
    const job = createEnvelope({
      source: { kind: "companion", deviceId: "desktop_001" },
      target: { kind: "phone", deviceId: "phone_001" },
      type: "job.completed",
      payload: {
        jobId: "job_backend_001",
        affairId: "affair_backend_001",
        executor: "openclaw",
        status: "completed",
        goal: "run tests",
        allowedPermissions: ["workspace.read"],
        progressSummary: "done",
      },
    });
    assert.equal(backend.applyProtocolEnvelope(affair).ok, true);
    assert.equal(backend.applyProtocolEnvelope(job).ok, true);
    const snapshot = backend.getSnapshot();
    assert.equal(snapshot.currentAffair?.status, "waiting_acceptance");
    assert.equal(snapshot.currentAffair?.progressSummary, "done");
  });

  it("非法状态迁移被拒绝，重复 messageId 幂等", () => {
    const backend = createCompanionBackendRuntime();
    const closed = createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "affair.create",
      payload: {
        affairId: "affair_backend_002",
        title: "已关闭事务",
        ownerAgent: "zhang-boss",
        status: "closed",
        context: [],
        acceptanceCriteria: ["用户验收"],
      },
    });
    const reopened = createEnvelope({
      source: { kind: "phone", deviceId: "phone_001" },
      target: { kind: "companion", deviceId: "desktop_001" },
      type: "affair.update",
      payload: {
        affairId: "affair_backend_002",
        title: "已关闭事务",
        ownerAgent: "zhang-boss",
        status: "running",
        context: [],
        acceptanceCriteria: ["用户验收"],
      },
    });
    assert.equal(backend.applyProtocolEnvelope(closed).ok, true);
    assert.equal(backend.applyProtocolEnvelope(closed).duplicate, true);
    const result = backend.applyProtocolEnvelope(reopened);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "affair_illegal_transition");
    }
  });
});

