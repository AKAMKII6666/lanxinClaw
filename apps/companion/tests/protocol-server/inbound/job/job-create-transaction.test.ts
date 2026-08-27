/**
 * job.create 事务边界单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import {
  createJsonReader,
  openSession,
  startHarness,
} from "../../../protocol-server/harness.js";

describe("job.create transaction", () => {
  it("成功 ack 后 store=needs_permission 且 gate 有 pending", { timeout: 10000 }, async () => {
    const { backend, identityStore, server, socket } = await startHarness();
    const reader = createJsonReader(socket);
    await openSession(socket, reader, identityStore);

    backend.getState().affairs.set("affair_tx", {
      affairId: "affair_tx",
      title: "tx",
      ownerAgent: "zhang-boss",
      status: "running",
      context: [],
      acceptanceCriteria: [],
      currentJobId: null,
      blockedReason: null,
      resumeCondition: null,
    });

    socket.send(JSON.stringify(createEnvelope({
      source: { kind: "phone", deviceId: "phone_srv_001" },
      target: { kind: "companion", deviceId: "desktop_srv_001" },
      type: "job.create",
      payload: {
        jobId: "job_tx_ok",
        affairId: "affair_tx",
        executor: "openclaw",
        status: "queued",
        goal: "tx goal",
        workspaceHint: null,
        allowedPermissions: ["workspace.read"],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      },
    })));

    let ack: { ok?: boolean } | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const msg = await reader.next("job.create ack");
      if (typeof msg.ok === "boolean") {
        ack = msg;
        break;
      }
    }
    assert.ok(ack);
    assert.equal(ack!.ok, true);
    assert.equal(backend.getState().jobs.get("job_tx_ok")?.status, "needs_permission");
    assert.equal(backend.getPermissionGate().hasPendingForJob("job_tx_ok"), true);

    socket.close();
    await server.close();
  });

  it("jobId 冲突时不 ack 且 gate 无 pending", { timeout: 10000 }, async () => {
    const { backend, identityStore, server, socket } = await startHarness();
    const reader = createJsonReader(socket);
    await openSession(socket, reader, identityStore);

    backend.getState().affairs.set("affair_tx2", {
      affairId: "affair_tx2",
      title: "tx2",
      ownerAgent: "zhang-boss",
      status: "running",
      context: [],
      acceptanceCriteria: [],
      currentJobId: null,
      blockedReason: null,
      resumeCondition: null,
    });
    backend.getState().jobs.set("job_tx_fail", {
      jobId: "job_tx_fail",
      affairId: "affair_tx2",
      executor: "openclaw",
      status: "completed",
      goal: "original goal",
      workspaceHint: null,
      allowedPermissions: ["workspace.read"],
      progressSummary: "",
      blockedReason: null,
      resumeCondition: null,
      permissionRequestId: null,
    });

    socket.send(JSON.stringify(createEnvelope({
      source: { kind: "phone", deviceId: "phone_srv_001" },
      target: { kind: "companion", deviceId: "desktop_srv_001" },
      type: "job.create",
      payload: {
        jobId: "job_tx_fail",
        affairId: "affair_tx2",
        executor: "openclaw",
        status: "queued",
        goal: "different goal",
        workspaceHint: null,
        allowedPermissions: ["workspace.read"],
        progressSummary: "",
        blockedReason: null,
        resumeCondition: null,
        permissionRequestId: null,
      },
    })));

    let ack: { ok?: boolean; error?: { code?: string } } | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const msg = await reader.next("job.create ack");
      if (typeof msg.ok === "boolean") {
        ack = msg;
        break;
      }
    }
    assert.ok(ack);
    assert.equal(ack!.ok, false);
    assert.equal(ack!.error?.code, "job_id_conflict");
    assert.equal(backend.getPermissionGate().hasPendingForJob("job_tx_fail"), false);

    socket.close();
    await server.close();
  });
});
