/**
 * 内存 Mock OpenClaw runtime。
 *
 * 职责：为 contract test 与无 Gateway 环境提供 create/get/cancel run。
 * 不拥有：真实 Gateway、凭据、companion 权限。
 * 副作用：仅修改进程内 Map；无网络与磁盘 I/O。
 */

import type {
  CreateOpenClawRunParams,
  OpenClawRunContext,
  OpenClawRunSnapshot,
  OpenClawRuntimeClient,
} from "./runtime-client.js";
import { buildExecutionEvidence } from "../evidence/openclaw-execution-evidence.js";
import type { OpenClawRunStatus } from "../status/openclaw-run-status.js";

const TERMINAL: readonly OpenClawRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
];

/**
 * 可变 mock 的附加控制面（仅测试推进状态）。
 */
export interface MutableMockOpenClawRuntime {
  /** 实现 OpenClawRuntimeClient */
  client: OpenClawRuntimeClient;
  /**
   * 将指定 run 推进到目标状态（仅测试；无网络）。
   *
   * @param input 目标 run 与状态
   */
  advance: (input: AdvanceMockRunInput) => void;
}

/**
 * 测试推进 mock run 的入参。
 */
export interface AdvanceMockRunInput {
  /** 要推进的 OpenClaw run id */
  runId: string;
  /** 目标规范化状态 */
  status: OpenClawRunStatus;
  /** 可选摘要/阻塞字段补丁；可省略 */
  patch?: Pick<OpenClawRunSnapshot, "summary" | "blockedReason" | "resumeCondition">;
}

/**
 * 构造可变 mock runtime（支持测试推进状态）。
 *
 * @returns client 与 advance 辅助
 */
export function createMutableMockOpenClawRuntimeClient(): MutableMockOpenClawRuntime {
  const runs = new Map<string, OpenClawRunSnapshot>();
  let seq = 0;

  const client: OpenClawRuntimeClient = {
    async createRun(params: CreateOpenClawRunParams): Promise<OpenClawRunSnapshot> {
      seq += 1;
      const runId = `ocrun_mock_${seq}`;
      const snapshot: OpenClawRunSnapshot = {
        runId,
        status: "accepted",
        summary: `accepted:${params.input.slice(0, 80)}`,
        blockedReason: null,
        resumeCondition: null,
      };
      runs.set(runId, snapshot);
      return { ...snapshot };
    },

    async getRun(runId: string, context?: OpenClawRunContext): Promise<OpenClawRunSnapshot> {
      const found = runs.get(runId);
      if (!found) {
        throw new Error(`mock_run_not_found:${runId}`);
      }
      return withEvidence(found, context);
    },

    async cancelRun(runId: string, context?: OpenClawRunContext): Promise<OpenClawRunSnapshot> {
      const found = runs.get(runId);
      if (!found) {
        throw new Error(`mock_run_not_found:${runId}`);
      }
      if (TERMINAL.includes(found.status)) {
        return withEvidence(found, context);
      }
      const next: OpenClawRunSnapshot = {
        ...found,
        status: "cancelled",
        summary: "cancelled_by_adapter",
      };
      runs.set(runId, next);
      return withEvidence(next, context, true);
    },
  };

  return {
    client,
    advance(input) {
      const found = runs.get(input.runId);
      if (!found) {
        throw new Error(`mock_run_not_found:${input.runId}`);
      }
      const next: OpenClawRunSnapshot = {
        runId: found.runId,
        status: input.status,
        blockedReason: input.patch?.blockedReason ?? found.blockedReason ?? null,
        resumeCondition: input.patch?.resumeCondition ?? found.resumeCondition ?? null,
      };
      const summary = input.patch?.summary ?? found.summary;
      if (summary !== undefined) {
        next.summary = summary;
      }
      runs.set(input.runId, next);
    },
  };
}

function withEvidence(
  snapshot: OpenClawRunSnapshot,
  context?: OpenClawRunContext,
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

/**
 * 构造不可变控制面的内存 mock（生产前本地占位亦可）。
 *
 * @returns 仅含 client 能力的 runtime 实现
 */
export function createMockOpenClawRuntimeClient(): OpenClawRuntimeClient {
  return createMutableMockOpenClawRuntimeClient().client;
}
