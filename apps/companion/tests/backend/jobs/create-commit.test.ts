/** job 创建落盘失败不能遗留新 currentJobId 或去重假证据。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createEnvelope } from "@lanxin-claw/protocol";
import { createCompanionBackendState } from "../../../src/state/store.js";
import { commitJobCreation } from "../../../src/backend/jobs/create.js";

test("创建镜像落盘失败原子回滚，原请求可再次提交", () => {
  const state = createCompanionBackendState();
  state.affairs.set("affair_commit", { affairId: "affair_commit", title: "检查", ownerAgent: "zhang-boss", status: "blocked", context: [], acceptanceCriteria: [], currentJobId: "job_old" });
  const payload = { jobId: "job_new", affairId: "affair_commit", executor: "openclaw", status: "queued", goal: "重新检查目录", allowedPermissions: ["workspace.read"] };
  const command = createEnvelope({ type: "job.create", source: { kind: "phone", deviceId: "phone_commit" }, target: { kind: "companion", deviceId: "desktop_commit" }, payload });
  const event = createEnvelope({ type: "job.needs_permission", source: command.target, target: command.source, payload: { ...payload, status: "needs_permission" } });
  const failed = commitJobCreation(state, command, [event], () => { throw new Error("disk full"); });
  assert.equal(failed.ok, false);
  assert.equal(state.affairs.get("affair_commit")?.currentJobId, "job_old");
  assert.equal(state.jobs.has("job_new"), false);
  assert.equal(state.seenMessages.has(command.messageId), false);
  assert.equal(commitJobCreation(state, command, [event], () => {}).ok, true);
  assert.equal(state.affairs.get("affair_commit")?.currentJobId, "job_new");
  assert.equal(state.jobs.get("job_new")?.status, "needs_permission");
  assert.equal(state.seenMessages.has(command.messageId), true);
});
