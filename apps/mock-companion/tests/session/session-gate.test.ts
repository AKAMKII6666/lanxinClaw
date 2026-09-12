/**
 * Mock companion session 门闩测试。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROTOCOL_VERSION,
  createEnvelope,
} from "@lanxin-claw/protocol";
import { routeInboundMessage } from "../../src/bridge/message-router.js";
import { loadMockCompanionConfig } from "../../src/config.js";
import { createMemoryStore } from "../../src/store/memory-store.js";

const noopEmit = (): void => undefined;

test("未 session 时 affair.create 被拒（session_required）", () => {
  const store = createMemoryStore(Date.now());
  const config = loadMockCompanionConfig({} as NodeJS.ProcessEnv);
  const result = routeInboundMessage(
    store,
    config,
    createEnvelope({
      source: { kind: "phone", deviceId: "phone_gate_001" },
      target: { kind: "companion", deviceId: config.desktopDeviceId },
      type: "affair.create",
      payload: {
        affairId: "affair_gate_001",
        title: "未认证事务",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: [],
        blockedReason: null,
        resumeCondition: null,
        currentJobId: null,
      },
    }),
    noopEmit,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "session_required");
  }
  assert.equal(store.affairs.has("affair_gate_001"), false);
});

test("未 session 时 job.create 被拒且不入权限队列", () => {
  const store = createMemoryStore(Date.now());
  const config = loadMockCompanionConfig({} as NodeJS.ProcessEnv);
  const result = routeInboundMessage(
    store,
    config,
    createEnvelope({
      source: { kind: "phone", deviceId: "phone_gate_002" },
      target: { kind: "companion", deviceId: config.desktopDeviceId },
      type: "job.create",
      payload: {
        jobId: "job_gate_002",
        affairId: "affair_gate_002",
        executor: "openclaw",
        status: "queued",
        goal: "gate job",
        workspaceHint: null,
        allowedPermissions: ["workspace.read"],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      },
    }),
    noopEmit,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "session_required");
  }
  assert.equal(store.jobs.has("job_gate_002"), false);
  assert.equal(store.permissionItems.length, 0);
});

test("pairing.request 无需 session 仍可处理", () => {
  const store = createMemoryStore(Date.now());
  const config = loadMockCompanionConfig({} as NodeJS.ProcessEnv);
  const result = routeInboundMessage(
    store,
    config,
    createEnvelope({
      source: { kind: "phone", deviceId: "phone_gate_003" },
      target: { kind: "companion", deviceId: config.desktopDeviceId },
      type: "pairing.request",
      payload: {
        pairingId: "pair_gate_003",
        phoneDeviceId: "phone_gate_003",
        phoneDisplayName: "gate phone",
        protocolVersion: PROTOCOL_VERSION,
        capabilities: [],
      },
    }),
    noopEmit,
  );
  assert.equal(result.ok, true);
  assert.equal(store.pendingChallenge?.pairingId, "pair_gate_003");
});

test("已 session 时空 allowedPermissions 拒绝且不入队", () => {
  const store = createMemoryStore(Date.now());
  store.session = {
    sessionId: "sess_empty",
    phoneDeviceId: "phone_empty_001",
    openedAt: new Date().toISOString(),
  };
  const config = loadMockCompanionConfig({} as NodeJS.ProcessEnv);
  const affair = routeInboundMessage(
    store,
    config,
    createEnvelope({
      source: { kind: "phone", deviceId: "phone_empty_001" },
      target: { kind: "companion", deviceId: config.desktopDeviceId },
      type: "affair.create",
      payload: {
        affairId: "affair_empty_001",
        title: "空权限",
        ownerAgent: "zhang-boss",
        status: "ready",
        context: [],
        acceptanceCriteria: [],
        blockedReason: null,
        resumeCondition: null,
        currentJobId: null,
      },
    }),
    noopEmit,
  );
  assert.equal(affair.ok, true);
  const emitted: string[] = [];
  const result = routeInboundMessage(
    store,
    config,
    createEnvelope({
      source: { kind: "phone", deviceId: "phone_empty_001" },
      target: { kind: "companion", deviceId: config.desktopDeviceId },
      type: "job.create",
      payload: {
        jobId: "job_empty_001",
        affairId: "affair_empty_001",
        executor: "openclaw",
        status: "queued",
        goal: "empty",
        workspaceHint: null,
        allowedPermissions: [],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      },
    }),
    (envelope) => {
      emitted.push(envelope.type);
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "job_permissions_required");
  }
  assert.equal(store.jobs.has("job_empty_001"), false);
  assert.equal(emitted.includes("job.accepted"), false);
});
