/**
 * job.create 能力预检单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { precheckJobCreate } from "../../src/protocol-server/job-create-precheck.js";
import { summarizeOpenClawToolCapabilities } from "../../src/gateway-runtime/openclaw-capability.js";

function fakeBackend(opts: { affair?: boolean; job?: unknown } = {}) {
  const affairs = new Map<string, unknown>();
  const jobs = new Map<string, unknown>();
  if (opts.affair !== false) {
    affairs.set("affair_1", { affairId: "affair_1" });
  }
  if (opts.job) {
    jobs.set("job_1", opts.job);
  }
  return {
    getState: () => ({
      seenMessages: new Set<string>(),
      affairs,
      jobs,
    }),
  } as never;
}

test("联网 job 在能力缺失时返回 capability_missing", () => {
  const result = precheckJobCreate(
    fakeBackend(),
    {
      messageId: "m1",
      type: "job.create",
      payload: {
        affairId: "affair_1",
        jobId: "job_1",
        goal: "打开浏览器搜索BNB当前价格",
        purpose: "execution",
        allowedPermissions: ["network.access"],
      },
    } as never,
    {
      getOpenClawToolCapabilities: () => summarizeOpenClawToolCapabilities(null),
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "capability_missing");
    assert.equal(result.nextStep, "configure_openclaw_web_tools");
  }
});

test("本地 workspace.read 探索不被能力门误杀", () => {
  const result = precheckJobCreate(
    fakeBackend(),
    {
      messageId: "m2",
      type: "job.create",
      payload: {
        affairId: "affair_1",
        jobId: "job_2",
        goal: "列出工作区根目录",
        purpose: "exploration",
        allowedPermissions: ["workspace.read"],
      },
    } as never,
    {
      getOpenClawToolCapabilities: () => summarizeOpenClawToolCapabilities(null),
    },
  );
  assert.deepEqual(result, { ok: true, duplicate: false });
});

test("仅 web_search ready 时 browser 意图仍 capability_missing", () => {
  const searchOnly = summarizeOpenClawToolCapabilities(
    {
      tools: {
        web: { search: { enabled: true, provider: "brave" } },
        alsoAllow: ["group:web"],
      },
    },
    { hasBraveApiKey: true },
  );
  const result = precheckJobCreate(
    fakeBackend(),
    {
      messageId: "m3",
      type: "job.create",
      payload: {
        affairId: "affair_1",
        jobId: "job_3",
        goal: "打开浏览器搜索BNB当前价格",
        purpose: "execution",
        allowedPermissions: ["network.access"],
      },
    } as never,
    { getOpenClawToolCapabilities: () => searchOnly },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "capability_missing");
  }
});
