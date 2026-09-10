/**
 * Runtime snapshot 归属校验。
 *
 * 职责：确认 OpenClaw 返回的 run/evidence 属于当前 Lanxin job。
 * 不拥有：状态映射、runtime I/O、协议广播。
 * 纯函数：无 I/O。
 */

import type { OpenClawRunSnapshot } from "../client/runtime-client.js";
import type { AdapterJobRecord } from "../jobs/job-types.js";
import { sessionKeysEquivalent, toGatewaySessionKey } from "../client/gateway/session-key.js";

/** snapshot 归属校验结果。 */
export type SnapshotIdentityResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * 校验 run 快照是否属于给定 job。
 *
 * @param job 当前 adapter job
 * @param snapshot runtime 返回快照
 * @returns 归属一致或 mismatch
 */
export function validateRunSnapshotIdentity(
  job: AdapterJobRecord,
  snapshot: OpenClawRunSnapshot,
): SnapshotIdentityResult {
  if (job.openclawRunId && snapshot.runId !== job.openclawRunId) {
    return mismatch("runId");
  }
  const evidence = snapshot.evidence;
  if (!evidence) {
    return { ok: true };
  }
  if (evidence.runId !== snapshot.runId) {
    return mismatch("evidence.runId");
  }
  if (evidence.jobId && evidence.jobId !== job.jobId) {
    return mismatch("evidence.jobId");
  }
  if (evidence.affairId && evidence.affairId !== job.affairId) {
    return mismatch("evidence.affairId");
  }
  const expectedSessionKey = job.openclawSessionKey ?? toGatewaySessionKey(job.jobId);
  if (evidence.sessionKey && !sessionKeysEquivalent(expectedSessionKey, evidence.sessionKey, job.jobId)) {
    return mismatch("evidence.sessionKey");
  }
  return { ok: true };
}

function mismatch(field: string): SnapshotIdentityResult {
  return {
    ok: false,
    message: `runtime snapshot identity mismatch: ${field}`,
  };
}
