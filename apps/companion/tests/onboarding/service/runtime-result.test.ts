/** 拒绝把运行中、认证失败与空结果探针当成模型就绪。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RUNTIME_PROBE_MARKER, waitForRuntimeProbeResult } from "../../../src/onboarding/probe/runtime-result.js";

test("先 running 后认证失败必须拒绝就绪", async () => {
  let reads = 0;
  const result = await waitForRuntimeProbeResult(async () => ({ ok: true,
    job: { status: ++reads === 1 ? "running" : "failed", resultDigest: null, blockedReason: "provider HTTP 401" } }), 100, 1);
  assert.deepEqual(result, { ok: false, code: "runtime_probe_failed", message: "provider HTTP 401" });
  assert.equal(reads, 2);
});

test("只有完成并返回预期模型文本才就绪", async () => {
  let reads = 0;
  const result = await waitForRuntimeProbeResult(async () => ({ ok: true,
    job: { status: ++reads === 1 ? "running" : "completed", resultDigest: RUNTIME_PROBE_MARKER, blockedReason: null } }), 100, 1);
  assert.deepEqual(result, { ok: true });
  assert.equal(reads, 2);
});

test("空完成与持续运行都不能通过模型探针", async () => {
  const empty = await waitForRuntimeProbeResult(async () => ({ ok: true,
    job: { status: "completed", resultDigest: null, blockedReason: null } }));
  assert.equal(empty.ok, false);
  const unconfirmed = await waitForRuntimeProbeResult(async () => ({ ok: true,
    job: { status: "running", resultDigest: null, blockedReason: null } }), 5, 1);
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.code, "runtime_probe_unconfirmed");
});
