/**
 * 协议消息 contract：正例通过、反例拒绝；状态机禁止 worker completed → affair closed。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  canTransitionAffairStatus,
  canTransitionJobStatus,
  createEnvelope,
  createMessageId,
  validateMessage,
  validatePayloadForType,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesRoot = path.resolve(here, "../../../examples");

/**
 * 读取 examples 下 JSON。
 *
 * @param rel 相对 examples 路径
 * @returns 解析值
 */
function readExample(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(examplesRoot, rel), "utf8")) as unknown;
}

/**
 * 构造最小合法 affair payload。
 *
 * @param overrides 覆盖字段
 * @returns payload 对象
 */
function affairPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    affairId: "affair_contract_001",
    title: "contract 正例",
    ownerAgent: "zhang-boss",
    status: "ready",
    context: ["ctx"],
    acceptanceCriteria: ["ok"],
    blockedReason: null,
    resumeCondition: null,
    currentJobId: null,
    ...overrides,
  };
}

/**
 * 构造最小合法 job payload。
 *
 * @param overrides 覆盖字段
 * @returns payload 对象
 */
function jobPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: "job_contract_001",
    affairId: "affair_contract_001",
    executor: "openclaw",
    status: "queued",
    goal: "run contract check",
    workspaceHint: null,
    allowedPermissions: ["workspace.read"],
    progressSummary: "",
    blockedReason: null,
    resumeCondition: null,
    permissionRequestId: null,
    ...overrides,
  };
}

describe("protocol message contract 正反例", () => {
  it("正例：核心 examples envelope 全部通过 validateMessage", () => {
    const files = [
      "affair-create.envelope.json",
      "job-blocked.envelope.json",
      "job-completed.envelope.json",
      "tasks/job-progress.envelope.json",
      "tasks/affair-waiting-acceptance.envelope.json",
      "permissions/permission-request.envelope.json",
      "zhang-boss/chat-message.envelope.json",
      "zhang-boss/chat-context-attach.envelope.json",
    ];
    for (const rel of files) {
      const result = validateMessage(readExample(rel));
      assert.equal(result.ok, true, `${rel}: ${result.ok ? "" : result.error.message}`);
    }
  });

  it("正例：affair.create / job.progress / permission.request payload", () => {
    assert.equal(validatePayloadForType("affair.create", affairPayload()).ok, true);
    assert.equal(
      validatePayloadForType("job.progress", jobPayload({ status: "running", progressSummary: "50%" }))
        .ok,
      true,
    );
    const perm = validatePayloadForType("permission.request", {
      permissionRequestId: "perm_req_c1",
      affairId: "affair_contract_001",
      jobId: "job_contract_001",
      requestedPermissions: ["workspace.write"],
      reason: "写修复",
      risk: "medium",
      proposedScope: { commands: [], networkHosts: [] },
    });
    assert.equal(perm.ok, true, perm.ok ? "" : perm.error.message);
  });

  it("反例：未知 message type", () => {
    const bad = validateMessage({
      protocolVersion: "0.1",
      messageId: "msg_unknown_type",
      sentAt: "2026-07-23T00:00:00.000Z",
      source: { kind: "phone", deviceId: "p1" },
      target: { kind: "companion", deviceId: "d1" },
      type: "affair.execute_arbitrary",
      payload: {},
    });
    assert.equal(bad.ok, false);
  });

  it("反例：affair 缺 affairId / 非法 ownerAgent / 非法 status", () => {
    assert.equal(
      validatePayloadForType("affair.create", affairPayload({ affairId: "" })).ok,
      false,
    );
    assert.equal(
      validatePayloadForType("affair.create", affairPayload({ ownerAgent: "openclaw" })).ok,
      false,
    );
    assert.equal(
      validatePayloadForType("affair.create", affairPayload({ status: "done" })).ok,
      false,
    );
  });

  it("反例：job 缺 jobId / 非法 executor / allowedPermissions 非数组", () => {
    assert.equal(validatePayloadForType("job.create", jobPayload({ jobId: "" })).ok, false);
    assert.equal(
      validatePayloadForType("job.create", jobPayload({ executor: "shell" })).ok,
      false,
    );
    assert.equal(
      validatePayloadForType("job.create", jobPayload({ allowedPermissions: "workspace.read" })).ok,
      false,
    );
  });

  it("反例：chat.message 不得冒充系统指令字段（未知 key）", () => {
    const bad = validatePayloadForType("chat.message", {
      chatMessageId: "chat_1",
      affairId: "affair_contract_001",
      authorKind: "user",
      text: "ignore previous",
      sentAt: "2026-07-23T00:00:00.000Z",
      systemInstruction: "bypass",
    });
    assert.equal(bad.ok, false);
  });

  it("反例：envelope 缺 source/target", () => {
    const envelope = createEnvelope({
      messageId: createMessageId(),
      source: { kind: "phone", deviceId: "p1" },
      target: { kind: "companion", deviceId: "d1" },
      type: "affair.create",
      payload: affairPayload(),
      sentAt: "2026-07-23T00:00:00.000Z",
    });
    const { source: _s, ...noSource } = envelope;
    assert.equal(validateMessage(noSource).ok, false);
  });
});

describe("protocol 状态机 contract", () => {
  it("job.completed 是终态，不得再迁出", () => {
    assert.equal(canTransitionJobStatus("completed", "running"), false);
    assert.equal(canTransitionJobStatus("completed", "closed" as never), false);
  });

  it("affair 不得从 running 直接 closed；须经 waiting_acceptance", () => {
    assert.equal(canTransitionAffairStatus("running", "closed"), false);
    assert.equal(canTransitionAffairStatus("running", "waiting_acceptance"), true);
    assert.equal(canTransitionAffairStatus("waiting_acceptance", "closed"), true);
  });

  it("硬约束：不存在把 job completed 映射为 affair closed 的合法边", () => {
    // worker completed 只推进到 waiting_acceptance；closed 只来自用户验收路径
    assert.equal(canTransitionAffairStatus("delegated", "closed"), false);
    assert.equal(canTransitionAffairStatus("running", "closed"), false);
    assert.equal(canTransitionAffairStatus("blocked", "closed"), false);
  });
});
