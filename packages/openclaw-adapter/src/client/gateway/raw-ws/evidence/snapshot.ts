/**
 * Gateway run snapshot 归一化。
 *
 * 职责：把 agent/agent.wait/chat.abort 响应转换成 legacy snapshot，并附带内部证据。
 * 不拥有：WebSocket RPC、补充探针执行、Lanxin job 状态裁决。
 * 纯函数：无 I/O。
 */

import type { OpenClawRunContext, OpenClawRunSnapshot } from "../../../runtime-client.js";
import type { GatewayCreateRunRequest } from "../../transport.js";
import { GatewayTransportError } from "../../transport.js";
import type {
  OpenClawExecutionEvidence,
  OpenClawFinalReplyEvidence,
  OpenClawGatewayCapabilities,
  OpenClawLifecycleEvidence,
} from "../../../../evidence/openclaw-execution-evidence.js";
import type { OpenClawRunStatus } from "../../../../status/openclaw-run-status.js";
import { parseToolFindingsFromRunPayload, type SupplementalEvidence } from "./probes.js";
import { readRecord, readString, readTextLike, readTimeLike } from "../framing/readers.js";

/** 状态别名 → legacy snapshot 状态；wait-only timeout 的原始语义仍保留在 evidence。 */
const STATUS_ALIASES: Record<string, OpenClawRunStatus> = {
  accepted: "accepted",
  queued: "accepted",
  in_flight: "accepted",
  running: "running",
  approval_required: "waiting_approval",
  "approval.request": "waiting_approval",
  waiting_approval: "waiting_approval",
  blocked: "blocked",
  completed: "completed",
  failed: "failed",
  error: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
  aborted: "cancelled",
  abort: "cancelled",
  timed_out: "timed_out",
  terminal_timeout: "timed_out",
  timeout: "running",
  ok: "completed",
  done: "completed",
  success: "completed",
};

/** normalizeRunSnapshot 的上下文。 */
export interface NormalizeRunSnapshotOptions {
  /** Lanxin job/affair/session 关联上下文。 */
  context?: OpenClawRunContext | GatewayCreateRunRequest;
  /** Gateway hello-ok 能力快照。 */
  capabilities: OpenClawGatewayCapabilities;
  /** OpenClaw session key；用于证据关联。 */
  sessionKey?: string | null;
  /** audit/task/history 补充证据。 */
  probeEvidence?: SupplementalEvidence;
  /** cancelRun 本地 abort ack 标记。 */
  localCancelAck?: boolean;
}

/**
 * 规范化 Gateway run 快照，并附带 adapter 内部证据。
 *
 * @param value 原始载荷
 * @param operation 操作名（错误信息用）
 * @param options 关联上下文
 * @returns 快照
 */
export function normalizeRunSnapshot(
  value: unknown,
  operation: string,
  options: NormalizeRunSnapshotOptions,
): OpenClawRunSnapshot {
  if (!value || typeof value !== "object") {
    throw new GatewayTransportError("gateway_invalid_run", `${operation} 返回值不是 run 对象`, false);
  }
  const raw = value as Record<string, unknown>;
  const runId = readString(raw, ["runId", "id"]);
  if (!runId) {
    throw new GatewayTransportError("gateway_invalid_run", `${operation} 返回值缺少 runId`, false);
  }
  const rawStatus = readString(raw, ["status", "state"]);
  const status = normalizeStatus(rawStatus, raw);
  if (!status) {
    return snapshotFromError(raw, runId, operation, options);
  }
  return snapshotFromStatus(raw, runId, status, rawStatus ?? status, options);
}

function snapshotFromError(
  raw: Record<string, unknown>,
  runId: string,
  operation: string,
  options: NormalizeRunSnapshotOptions,
): OpenClawRunSnapshot {
  const error = readRecord(raw, ["error"]);
  if (!error) {
    throw new GatewayTransportError("gateway_invalid_run", `${operation} 返回值缺少 status`, false);
  }
  const summary = readString(error, ["message", "code"]) ?? "run_failed";
  return {
    runId,
    status: "failed",
    summary,
    evidence: buildGatewayEvidence(raw, { ...options, runId, status: "failed", rawStatus: "failed", summary }),
  };
}

function snapshotFromStatus(
  raw: Record<string, unknown>,
  runId: string,
  status: OpenClawRunStatus,
  rawStatus: string,
  options: NormalizeRunSnapshotOptions,
): OpenClawRunSnapshot {
  const summary = readString(raw, ["summary", "progressSummary", "message", "text", "output"]);
  const error = readRecord(raw, ["error"]);
  const errorMessage = error ? readString(error, ["message", "code"]) : null;
  const effectiveStatus = errorMessage && (status === "accepted" || status === "running") ? "failed" : status;
  const effectiveSummary = errorMessage ?? summary;
  return {
    runId,
    status: effectiveStatus,
    ...(effectiveSummary ? { summary: effectiveSummary } : {}),
    ...(errorMessage ? { blockedReason: errorMessage } : {}),
    evidence: buildGatewayEvidence(raw, {
      ...options,
      runId,
      status: effectiveStatus,
      rawStatus: errorMessage ? "failed" : rawStatus,
      summary: effectiveSummary,
    }),
  };
}

function buildGatewayEvidence(
  raw: Record<string, unknown>,
  input: NormalizeRunSnapshotOptions & {
    runId: string;
    status: OpenClawRunStatus;
    rawStatus: string;
    summary: string | null;
  },
): OpenClawExecutionEvidence {
  const error = readRecord(raw, ["error"]);
  const errorMessage = error ? readString(error, ["message", "code"]) : null;
  const lifecycle = mergeLifecycleEvidence(
    parseLifecyclePayload(raw, input.rawStatus),
    input.probeEvidence?.lifecycle,
  );
  const finalReply = input.probeEvidence?.finalReply ?? parseFinalReplyFromRunPayload(raw, input.summary, input.rawStatus);
  const toolFindings = [
    ...parseToolFindingsFromRunPayload(raw, input.runId),
    ...(input.probeEvidence?.toolFindings ?? []),
  ];
  return {
    runId: input.runId,
    ...(input.context?.jobId ? { jobId: input.context.jobId } : {}),
    ...(input.context?.affairId ? { affairId: input.context.affairId } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    observedAt: new Date().toISOString(),
    wait: waitEvidence(raw, input.rawStatus, errorMessage),
    ...(lifecycle ? { lifecycle } : {}),
    toolFindings,
    ...(input.probeEvidence?.task ? { task: input.probeEvidence.task } : {}),
    ...(finalReply ? { finalReply } : {}),
    gatewayCapabilities: input.capabilities,
    ...(input.probeEvidence?.probeResults.length ? { probeResults: input.probeEvidence.probeResults } : {}),
    ...(input.localCancelAck ? { localCancelAck: true } : {}),
    sourceStatuses: sourceStatusesFromInput(input.rawStatus, input.status),
  };
}

function waitEvidence(raw: Record<string, unknown>, rawStatus: string, errorMessage: string | null) {
  const startedAt = readTimeLike(raw, ["startedAt", "startTime", "createdAt"]);
  const endedAt = readTimeLike(raw, ["endedAt", "endTime", "completedAt", "finishedAt"]);
  const timeoutPhase = readTimeoutPhase(raw, rawStatus, Boolean(endedAt));
  return {
    status: rawStatus,
    ...(startedAt !== null ? { startedAt } : {}),
    ...(endedAt !== null ? { endedAt } : {}),
    ...(readString(raw, ["stopReason", "reason"]) ? { stopReason: readString(raw, ["stopReason", "reason"])! } : {}),
    ...(readString(raw, ["livenessState"]) ? { livenessState: readString(raw, ["livenessState"])! } : {}),
    ...(timeoutPhase ? { timeoutPhase } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}

function readTimeoutPhase(raw: Record<string, unknown>, rawStatus: string, hasEndedAt: boolean): string | null {
  const explicit = readString(raw, ["timeoutPhase"]);
  if (explicit) {
    return explicit;
  }
  return rawStatus.toLowerCase() === "timeout" && hasEndedAt ? "terminal" : null;
}

function parseFinalReplyFromRunPayload(
  raw: Record<string, unknown>,
  summary: string | null,
  rawStatus: string,
): OpenClawFinalReplyEvidence | undefined {
  const text = readTextLike(raw, ["finalReply", "reply", "message", "text", "output"]) ?? summary;
  if (!text) {
    return undefined;
  }
  const status = rawStatus.toLowerCase();
  const confidence = status === "ok" || status === "completed" ? "medium" : "weak";
  return { text, source: "wait-result", confidence };
}

function parseLifecyclePayload(
  raw: Record<string, unknown>,
  rawStatus: string,
): OpenClawLifecycleEvidence | undefined {
  const source = readRecord(raw, ["lifecycle", "run"]) ?? raw;
  const endedAt = readTimeLike(source, ["endedAt", "endTime", "completedAt", "finishedAt"]);
  const startedAt = readTimeLike(source, ["startedAt", "startTime", "createdAt"]);
  const terminalPhase = readTerminalPhase(source, rawStatus, Boolean(endedAt));
  if (!startedAt && !endedAt && !terminalPhase) {
    return undefined;
  }
  return {
    ...(startedAt !== null ? { startedAt } : {}),
    ...(endedAt !== null ? { endedAt } : {}),
    ...(terminalPhase ? { terminalPhase } : {}),
    ...(readString(source, ["terminalReason", "stopReason", "reason"])
      ? { terminalReason: readString(source, ["terminalReason", "stopReason", "reason"])! }
      : {}),
  };
}

function readTerminalPhase(raw: Record<string, unknown>, rawStatus: string, hasEndedAt: boolean): string | null {
  const explicit = readString(raw, ["terminalPhase", "phase"]);
  if (explicit) {
    return explicit;
  }
  const status = (readString(raw, ["status", "state", "outcome", "result"]) ?? rawStatus).toLowerCase();
  if (isTimeoutPhase(raw, status, hasEndedAt)) {
    return "timeout";
  }
  if (["error", "failed", "failure"].includes(status)) {
    return "error";
  }
  return hasEndedAt || ["ok", "completed", "done", "success"].includes(status) ? "end" : null;
}

function isTimeoutPhase(raw: Record<string, unknown>, status: string, hasEndedAt: boolean): boolean {
  return (
    status === "timed_out" ||
    status === "terminal_timeout" ||
    readString(raw, ["timeoutPhase"]) === "terminal" ||
    (status === "timeout" && hasEndedAt)
  );
}

function mergeLifecycleEvidence(
  left: OpenClawLifecycleEvidence | undefined,
  right: OpenClawLifecycleEvidence | undefined,
): OpenClawLifecycleEvidence | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return { ...left, ...right };
}

function normalizeStatus(value: string | null, raw?: Record<string, unknown>): OpenClawRunStatus | null {
  if (!value) {
    return null;
  }
  const lower = value.trim().toLowerCase();
  if (lower !== "timeout") {
    return STATUS_ALIASES[lower] ?? null;
  }
  const timeoutPhase = readString(raw ?? {}, ["timeoutPhase"])?.toLowerCase();
  const endedAt = raw ? readTimeLike(raw, ["endedAt", "endTime", "completedAt", "finishedAt"]) : null;
  return timeoutPhase === "terminal" || Boolean(endedAt) ? "timed_out" : "running";
}

function sourceStatusesFromInput(rawStatus: string, status: OpenClawRunStatus): string[] {
  return rawStatus === status ? [rawStatus] : [rawStatus, status];
}
