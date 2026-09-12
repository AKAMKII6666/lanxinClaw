/** 委派测试共用端口与等待条件；不包含测试用例。 */
import {
OpenClawAdapter,
createMutableMockOpenClawRuntimeClient
} from "@lanxin-claw/openclaw-adapter";
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import { JobDelegator } from "../../../../src/jobs/delegation/delegator.js";
import { PermissionGate } from "../../../../src/permissions/gate/permission-gate.js";


/**
 * 测试 harness。
 *
 * @returns 依赖
 */
export function createHarness(pollIntervalMs = 30) {
  const gate = new PermissionGate();
  const runtime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const broadcasts: ProtocolEnvelope[] = [];
  const jobStatuses = new Map<string, string>();
  const affairStatuses = new Map<string, string>();
  const affairCurrentJobIds = new Map<string, string | null>();
  const workspaceHints = new Map<string, string | null>();
  const delegator = new JobDelegator({
    adapter,
    gate,
    getJobStatus: (jobId) => jobStatuses.get(jobId),
    getWorkspaceHint: (jobId) =>
      workspaceHints.has(jobId) ? workspaceHints.get(jobId) : "F:/ws",
    getAffair: (affairId) =>
      ({
        affairId,
        title: "test affair",
        ownerAgent: "zhang-boss",
        status: (affairStatuses.get(affairId) ?? "running") as string,
        context: [],
        acceptanceCriteria: [],
        currentJobId: affairCurrentJobIds.has(affairId)
          ? affairCurrentJobIds.get(affairId)
          : gate.dump().requests.find((request) => request.affairId === affairId)?.jobId ?? null,
      } as never),
    getPhoneDeviceId: () => "phone_test_001",
    desktopDeviceId: "desktop_test_001",
    applyProtocolEnvelope: (envelope) => {
      const payload = envelope.payload as { jobId?: string; status?: string };
      if (payload.jobId && payload.status) {
        jobStatuses.set(payload.jobId, payload.status);
      }
      return { ok: true, envelope };
    },
    sendEnvelope: (envelope) => {
      broadcasts.push(envelope);
    },
    pollIntervalMs,
  });
  return { gate, runtime, adapter, broadcasts, jobStatuses, affairStatuses, affairCurrentJobIds, workspaceHints, delegator };
}

/**
 * 入队并裁决一条权限请求。
 *
 * @param gate gate
 * @param permissionRequestId 请求 id
 * @param jobId job id
 * @param decision 决策
 */
export function enqueueAndDecide(
  gate: PermissionGate,
  permissionRequestId: string,
  jobId: string,
  decision: string,
) {
  gate.enqueue({
    permissionRequestId,
    jobId,
    affairId: "affair_test_001",
    requester: "zhang-boss",
    requestedPermissions: ["workspace.read"],
    reason: "test goal",
    risk: "low",
    proposedScope: { workspaceRoot: "F:/ws" },
    denyConsequence: "job 停住",
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  });
  return gate.decide(permissionRequestId, decision);
}

/**
 * 等待条件成立。
 *
 * @param predicate 条件
 * @param timeoutMs 超时
 */
export async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
