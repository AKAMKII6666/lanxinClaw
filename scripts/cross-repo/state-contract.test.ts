/** 穷举真实 phone store 与 protocol 状态接口，拒绝任何迁移漂移。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { AFFAIR_STATUSES, JOB_STATUSES, canTransitionAffairStatus, canTransitionJobStatus } from "@lanxin-claw/protocol";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const phoneRoot = path.resolve(process.env.LANXIN_PHONE_REPO || path.join(repoRoot, "../doubaoSister"));
const require = createRequire(import.meta.url);
const { createLanxinClawStore } = require(path.join(phoneRoot, "phone/systems/lanxinClaw/lanxinClawStore.js"));

test("真实 phone store 与 protocol 的 81 个 affair 及 49 个 job 状态组合完全一致", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lanxin-state-contract-"));
  const store = createLanxinClawStore({ runtimePaths: { getRuntimeRoot: () => temp } });
  for (const from of AFFAIR_STATUSES) for (const to of AFFAIR_STATUSES) {
    assert.equal(store.canTransitionAffairStatus(from, to), canTransitionAffairStatus(from, to), `affair ${from} -> ${to}`);
  }
  for (const from of JOB_STATUSES) for (const to of JOB_STATUSES) {
    assert.equal(store.canTransitionJobStatus(from, to), canTransitionJobStatus(from, to), `job ${from} -> ${to}`);
  }
});
