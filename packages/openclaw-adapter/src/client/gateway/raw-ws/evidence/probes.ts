/**
 * Gateway 补充探针。
 *
 * 职责：按 hello-ok 能力读取 audit/task/history 证据；探针失败只记录，不裁决业务状态。
 * 不拥有：WebSocket 握手、agent.wait、Lanxin job 状态裁决。
 * 副作用：通过传入的 rpc 函数调用 Gateway。
 */

import type WebSocket from "ws";
import type { OpenClawRunContext } from "../../../runtime-client.js";
import type {
  OpenClawFinalReplyEvidence,
  OpenClawGatewayCapabilities,
  OpenClawLifecycleEvidence,
  OpenClawProbeResult,
  OpenClawTaskEvidence,
  OpenClawToolFinding,
  OpenClawToolFindingStatus,
} from "../../../../evidence/openclaw-execution-evidence.js";
import { GatewayTransportError } from "../../transport.js";
import { readNumber, readRecord, readRecordArray, readString, readTextLike, readTimeLike } from "../framing/readers.js";

/** Gateway RPC 函数。 */
export type GatewayRpc = (
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
) => Promise<Record<string, unknown>>;

/** 可选探针结果集合。 */
export interface SupplementalEvidence {
  /** audit/run payload 中解析出的 tool 结果。 */
  toolFindings: OpenClawToolFinding[];
  /** 各探针调用质量记录。 */
  probeResults: OpenClawProbeResult[];
  /** audit/run 中解析出的 lifecycle 终态线索。 */
  lifecycle?: OpenClawLifecycleEvidence;
  /** tasks.list 中匹配到的 task 线索。 */
  task?: OpenClawTaskEvidence;
  /** chat.history 中匹配到的最终回复。 */
  finalReply?: OpenClawFinalReplyEvidence;
}

/** 探针上下文。 */
export interface SupplementalProbeContext extends OpenClawRunContext {
  /** 当前 OpenClaw run id。 */
  runId: string;
  /** 当前 OpenClaw session key；无值则跳过 history 探针。 */
  sessionKey?: string | null;
  /** 单次探针 RPC 超时毫秒。 */
  timeoutMs: number;
}

/**
 * 采集 audit/task/history 补充证据。
 *
 * @param ws 已握手 socket
 * @param capabilities Gateway 能力
 * @param context run 上下文
 * @param rpc Gateway RPC 函数
 * @returns 补充证据
 */
export async function collectSupplementalEvidence(
  ws: WebSocket,
  capabilities: OpenClawGatewayCapabilities,
  context: SupplementalProbeContext,
  rpc: GatewayRpc,
): Promise<SupplementalEvidence> {
  const supplemental: SupplementalEvidence = { toolFindings: [], probeResults: [] };
  await collectAudit(ws, capabilities, context, rpc, supplemental);
  await collectTask(ws, capabilities, context, rpc, supplemental);
  await collectHistory(ws, capabilities, context, rpc, supplemental);
  return supplemental;
}

async function collectAudit(
  ws: WebSocket,
  capabilities: OpenClawGatewayCapabilities,
  context: SupplementalProbeContext,
  rpc: GatewayRpc,
  output: SupplementalEvidence,
): Promise<void> {
  const method = selectAuditMethod(capabilities);
  if (!method) {
    return;
  }
  const result = await optionalRpc(ws, method, probeParams(context, 50), context.timeoutMs, rpc);
  output.probeResults.push(probeResult("audit", result, method));
  if (!result.ok) {
    return;
  }
  const parsed = parseAuditPayload(result.payload, context.runId);
  output.toolFindings.push(...parsed.toolFindings);
  if (parsed.lifecycle) {
    output.lifecycle = parsed.lifecycle;
  }
}

async function collectTask(
  ws: WebSocket,
  capabilities: OpenClawGatewayCapabilities,
  context: SupplementalProbeContext,
  rpc: GatewayRpc,
  output: SupplementalEvidence,
): Promise<void> {
  if (!shouldTryMethod(capabilities, "tasks.list")) {
    return;
  }
  const result = await optionalRpc(ws, "tasks.list", taskListParams(20), context.timeoutMs, rpc);
  output.probeResults.push(probeResult("task", result, "tasks.list"));
  if (result.ok) {
    const task = parseTaskPayload(result.payload, context.runId, context.sessionKey ?? null);
    if (task) {
      output.task = task;
    }
  }
}

async function collectHistory(
  ws: WebSocket,
  capabilities: OpenClawGatewayCapabilities,
  context: SupplementalProbeContext,
  rpc: GatewayRpc,
  output: SupplementalEvidence,
): Promise<void> {
  if (!context.sessionKey || !shouldTryMethod(capabilities, "chat.history")) {
    return;
  }
  const result = await optionalRpc(
    ws,
    "chat.history",
    { sessionKey: context.sessionKey, limit: 20 },
    context.timeoutMs,
    rpc,
  );
  output.probeResults.push(probeResult("history", result, "chat.history"));
  if (result.ok) {
    const finalReply = parseHistoryFinalReply(result.payload);
    if (finalReply) {
      output.finalReply = finalReply;
    }
  }
}

function selectAuditMethod(capabilities: OpenClawGatewayCapabilities): "audit.activity.list" | "audit.list" | null {
  if (capabilities.methods.includes("audit.activity.list")) {
    return "audit.activity.list";
  }
  return shouldTryMethod(capabilities, "audit.list") ? "audit.list" : null;
}

function shouldTryMethod(capabilities: OpenClawGatewayCapabilities, method: string): boolean {
  return capabilities.methods.length === 0 || capabilities.methods.includes(method);
}

function probeParams(context: SupplementalProbeContext, limit: number): Record<string, unknown> {
  return {
    runId: context.runId,
    ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}),
    limit,
  };
}

function taskListParams(limit: number): Record<string, unknown> {
  return { limit };
}

async function optionalRpc(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  rpc: GatewayRpc,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; code: string; message: string }> {
  try {
    return { ok: true, payload: await rpc(ws, method, params, timeoutMs) };
  } catch (err) {
    if (err instanceof GatewayTransportError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: "gateway_probe_failed",
      message: err instanceof Error ? err.message : "Gateway 探针失败",
    };
  }
}

function probeResult(
  source: OpenClawProbeResult["source"],
  result: { ok: true; payload: Record<string, unknown> } | { ok: false; code: string; message: string },
  method: string,
): OpenClawProbeResult {
  return {
    source,
    ok: result.ok,
    observedAt: new Date().toISOString(),
    status: result.ok ? method : result.code,
    ...(!result.ok ? { error: result.message } : {}),
  };
}

function parseAuditPayload(
  payload: Record<string, unknown>,
  runId: string,
): { toolFindings: OpenClawToolFinding[]; lifecycle?: OpenClawLifecycleEvidence } {
  const items = readRecordArray(payload, ["activities", "items", "entries", "records", "events"]);
  const matching = items.filter((item) => belongsToRun(item, runId));
  const source = matching.length > 0 ? matching : items;
  const lifecycle = lifecycleFromRecords(source);
  return {
    toolFindings: source
      .map(toolFindingFromRecord)
      .filter((finding): finding is OpenClawToolFinding => Boolean(finding)),
    ...(lifecycle ? { lifecycle } : {}),
  };
}

function parseTaskPayload(
  payload: Record<string, unknown>,
  runId: string,
  sessionKey: string | null,
): OpenClawTaskEvidence | null {
  const items = readRecordArray(payload, ["tasks", "items", "entries", "records"]);
  const candidates = items.length > 0 ? items : [payload];
  const matched =
    candidates.find((item) => belongsToRun(item, runId)) ??
    candidates.find((item) => sessionKey !== null && readString(item, ["sessionKey"]) === sessionKey);
  return matched ? taskFromRecord(matched) : null;
}

/**
 * 从 agent/agent.wait 响应体中解析 tool/audit 结果。
 *
 * @param raw Gateway run 响应体
 * @param runId 当前 run id
 * @returns 匹配当前 run 的 tool 证据
 */
export function parseToolFindingsFromRunPayload(
  raw: Record<string, unknown>,
  runId: string,
): OpenClawToolFinding[] {
  const items = readRecordArray(raw, ["toolFindings", "toolResults", "tools", "activities", "events"]);
  return items
    .filter((item) => belongsToRun(item, runId))
    .map(toolFindingFromRecord)
    .filter((finding): finding is OpenClawToolFinding => Boolean(finding));
}

function taskFromRecord(record: Record<string, unknown>): OpenClawTaskEvidence {
  return {
    ...(readString(record, ["taskId", "id"]) ? { taskId: readString(record, ["taskId", "id"])! } : {}),
    ...(readString(record, ["status", "state"]) ? { status: readString(record, ["status", "state"])! } : {}),
    ...(readString(record, ["terminalOutcome", "outcome", "result"])
      ? { terminalOutcome: readString(record, ["terminalOutcome", "outcome", "result"])! }
      : {}),
    ...(readString(record, ["progressSummary", "summary"])
      ? { progressSummary: readString(record, ["progressSummary", "summary"])! }
      : {}),
    ...(readString(record, ["terminalSummary", "finalSummary"])
      ? { terminalSummary: readString(record, ["terminalSummary", "finalSummary"])! }
      : {}),
    ...(readString(record, ["error", "errorMessage", "message"])
      ? { error: readString(record, ["error", "errorMessage", "message"])! }
      : {}),
  };
}

function parseHistoryFinalReply(payload: Record<string, unknown>): OpenClawFinalReplyEvidence | null {
  const items = readRecordArray(payload, ["messages", "items", "entries", "history"]);
  const lastAssistant = [...items].reverse().find(isAssistantRecord);
  const text = lastAssistant
    ? readTextLike(lastAssistant, ["text", "content", "message", "summary"])
    : readTextLike(payload, ["text", "content", "message", "summary"]);
  return text ? { text, source: "history", confidence: "weak" } : null;
}

function isAssistantRecord(record: Record<string, unknown>): boolean {
  const role = readString(record, ["role", "authorRole", "author", "kind"]);
  return !role || /assistant|agent|model/.test(role.toLowerCase());
}

function lifecycleFromRecords(records: readonly Record<string, unknown>[]): OpenClawLifecycleEvidence | undefined {
  let lifecycle: OpenClawLifecycleEvidence | undefined;
  for (const record of records) {
    const parsed = parseLifecyclePayload(record, readString(record, ["status", "state", "type", "event"]) ?? "");
    if (parsed) {
      lifecycle = mergeLifecycle(lifecycle, parsed);
    }
  }
  return lifecycle;
}

function parseLifecyclePayload(raw: Record<string, unknown>, rawStatus: string): OpenClawLifecycleEvidence | undefined {
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
    ...(readNumber(source, ["highestSeq", "seq"]) !== null
      ? { highestSeq: readNumber(source, ["highestSeq", "seq"])! }
      : {}),
  };
}

function readTerminalPhase(raw: Record<string, unknown>, rawStatus: string, hasEndedAt: boolean): string | null {
  const explicit = readString(raw, ["terminalPhase", "phase"]);
  if (explicit) {
    return explicit;
  }
  const status = (readString(raw, ["status", "state", "outcome", "result"]) ?? rawStatus).toLowerCase();
  if (status === "timed_out" || readString(raw, ["timeoutPhase"]) === "terminal") return "timeout";
  if (["error", "failed", "failure"].includes(status)) {
    return "error";
  }
  return hasEndedAt || ["ok", "completed", "done", "success"].includes(status) ? "end" : null;
}

function mergeLifecycle(
  left: OpenClawLifecycleEvidence | undefined,
  right: OpenClawLifecycleEvidence,
): OpenClawLifecycleEvidence {
  const highestSeq = Math.max(left?.highestSeq ?? 0, right.highestSeq ?? 0);
  return { ...(left ?? {}), ...right, ...(highestSeq > 0 ? { highestSeq } : {}) };
}

function toolFindingFromRecord(record: Record<string, unknown>): OpenClawToolFinding | null {
  const status = classifyToolStatus([readString(record, ["status", "state", "outcome", "result", "phase"]), readString(record, ["errorCode", "code", "reason"]), readString(record, ["summary", "message", "error", "text"])].filter(Boolean).join(" "));
  const hasToolMarker = Boolean(readString(record, ["toolCallId", "toolName", "tool", "name"]));
  if (status === "unknown" && !hasToolMarker) {
    return null;
  }
  return {
    status,
    ...(readString(record, ["toolCallId", "callId", "id"]) ? { toolCallId: readString(record, ["toolCallId", "callId", "id"])! } : {}),
    ...(readString(record, ["toolName", "tool", "name"]) ? { toolName: readString(record, ["toolName", "tool", "name"])! } : {}),
    ...(readString(record, ["errorCode", "code", "reason"]) ? { errorCode: readString(record, ["errorCode", "code", "reason"])! } : {}),
    ...(readString(record, ["summary", "message", "error", "text"]) ? { summary: readString(record, ["summary", "message", "error", "text"])! } : {}),
  };
}

function classifyToolStatus(text: string): OpenClawToolFindingStatus {
  const value = text.toLowerCase();
  if (!value.trim()) return "unknown";
  if (/blocked|policy|permission|approval|denied|forbidden|not allowed|unauthorized|disabled|no provider|unavailable|not configured|missing provider|受限|阻止|阻塞|权限|授权|不可用|未配置|拒绝/.test(value)) return "blocked";
  if (/timed_out|timeout/.test(value)) return "timed_out";
  if (/cancelled|canceled|aborted/.test(value)) return "cancelled";
  if (/failed|failure|error|errored/.test(value)) return "failed";
  return /succeeded|success|completed|complete|done|ok/.test(value) ? "succeeded" : "unknown";
}

function belongsToRun(record: Record<string, unknown>, runId: string): boolean {
  const value = readString(record, ["runId", "agentRunId"]);
  return !value || value === runId;
}
