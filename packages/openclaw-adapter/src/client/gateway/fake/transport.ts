/**
 * Gateway fake transport。
 *
 * 职责：为 Gateway runtime client contract test 提供可控 run 状态。
 * 不拥有：真实 Gateway、凭据、权限裁决。
 * 副作用：仅更新内存。
 */

import type { OpenClawRunSnapshot } from "../../runtime-client.js";
import { buildExecutionEvidence } from "../../../evidence/openclaw-execution-evidence.js";
import type { GatewayCreateRunRequest, GatewayRunContext, GatewayTransport } from "../transport.js";
import { GatewayTransportError } from "../transport.js";

/**
 * Fake transport 控制面。
 */
export interface FakeGatewayTransport {
  /** transport 实现 */
  transport: GatewayTransport;
  /** 最近 create 请求 */
  createdRequests: GatewayCreateRunRequest[];
  /** 推进 run 状态 */
  advance: (runId: string, snapshot: Omit<OpenClawRunSnapshot, "runId">) => void;
}

/**
 * 创建 fake Gateway transport。
 *
 * @returns fake 控制面
 */
export function createFakeGatewayTransport(): FakeGatewayTransport {
  let seq = 0;
  const runs = new Map<string, OpenClawRunSnapshot>();
  const createdRequests: GatewayCreateRunRequest[] = [];
  const transport: GatewayTransport = {
    async createRun(request) {
      seq += 1;
      const runId = `ocgw_fake_${seq}`;
      createdRequests.push({
        ...request,
        scopes: [...request.scopes],
      });
      const snapshot: OpenClawRunSnapshot = {
        runId,
        status: "accepted",
        summary: "gateway accepted",
      };
      runs.set(runId, snapshot);
      return snapshot;
    },

    async getRun(runId, context) {
      const found = runs.get(runId);
      if (!found) {
        throw new GatewayTransportError("gateway_run_not_found", `找不到 runId=${runId}`, false);
      }
      return withEvidence(found, context);
    },

    async cancelRun(runId, context) {
      const found = runs.get(runId);
      if (!found) {
        throw new GatewayTransportError("gateway_run_not_found", `找不到 runId=${runId}`, false);
      }
      if (["completed", "failed", "cancelled", "timed_out"].includes(found.status)) {
        return withEvidence(found, context);
      }
      const canceled: OpenClawRunSnapshot = {
        ...found,
        status: "cancelled",
        summary: "gateway cancelled",
      };
      runs.set(runId, canceled);
      return withEvidence(canceled, context, true);
    },
  };
  return {
    transport,
    createdRequests,
    advance(runId, snapshot) {
      if (!runs.has(runId)) {
        throw new GatewayTransportError("gateway_run_not_found", `找不到 runId=${runId}`, false);
      }
      runs.set(runId, { runId, ...snapshot });
    },
  };
}

function withEvidence(
  snapshot: OpenClawRunSnapshot,
  context?: GatewayRunContext,
  localCancelAck = false,
): OpenClawRunSnapshot {
  return {
    ...snapshot,
    evidence: buildExecutionEvidence({
      runId: snapshot.runId,
      status: snapshot.status,
      ...(snapshot.summary !== undefined ? { summary: snapshot.summary } : {}),
      ...(snapshot.blockedReason !== undefined ? { blockedReason: snapshot.blockedReason } : {}),
      ...(snapshot.resumeCondition !== undefined ? { resumeCondition: snapshot.resumeCondition } : {}),
      ...(context?.jobId ? { jobId: context.jobId } : {}),
      ...(context?.affairId ? { affairId: context.affairId } : {}),
      ...(context?.sessionKey ? { sessionKey: context.sessionKey } : {}),
      localCancelAck,
    }),
  };
}
