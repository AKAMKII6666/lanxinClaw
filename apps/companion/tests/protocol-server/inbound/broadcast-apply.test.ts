/**
 * broadcast apply 失败不 send 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import WebSocket from "ws";
import { createEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendRuntime } from "../../../src/backend/runtime.js";
import { MemoryIdentityPersistence, createDeviceIdentityStore } from "../../../src/credentials/identity-store.js";
import { startCompanionProtocolServer } from "../../../src/protocol-server/server.js";

describe("broadcast apply gate", () => {
  it("非法 job 迁移不被广播到 phone", { timeout: 8000 }, async () => {
    const backend = createCompanionBackendRuntime();
    const server = await startCompanionProtocolServer({
      backend,
      identityStore: createDeviceIdentityStore(new MemoryIdentityPersistence()),
      pairing: { desktopDeviceId: "desktop_bc", desktopDisplayName: "d" },
    });
    const socket = new WebSocket(server.wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const queue: unknown[] = [];
    socket.on("message", (data) => {
      queue.push(JSON.parse(data.toString()));
    });

    backend.getState().jobs.set("job_terminal", {
      jobId: "job_terminal",
      affairId: "affair_t",
      executor: "openclaw",
      status: "completed",
      goal: "done",
      workspaceHint: null,
      allowedPermissions: ["workspace.read"],
      progressSummary: "",
      blockedReason: null,
      resumeCondition: null,
      permissionRequestId: null,
    });

    server.broadcast(
      createEnvelope({
        source: { kind: "companion", deviceId: "desktop_bc" },
        target: { kind: "phone", deviceId: "phone_bc" },
        type: "job.progress",
        payload: {
          jobId: "job_terminal",
          affairId: "affair_t",
          executor: "openclaw",
          status: "running",
          goal: "done",
          allowedPermissions: ["workspace.read"],
          progressSummary: "illegal revive",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(queue.length, 0);
    assert.equal(backend.getState().jobs.get("job_terminal")?.status, "completed");

    socket.close();
    await server.close();
  });
});
