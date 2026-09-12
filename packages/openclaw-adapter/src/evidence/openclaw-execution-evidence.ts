/**
 * OpenClaw 执行观测证据。
 *
 * 职责：描述 adapter 内部用于状态裁决的多源证据。
 * 不拥有：Lanxin 协议 payload、companion 权限、OpenClaw RPC 细节。
 * 纯函数：仅类型与小型构造辅助。
 */

import type { OpenClawRunStatus } from "../status/openclaw-run-status.js";

/** 证据来源强度；success/terminal 推进必须优先依赖 strong/medium 结构化证据。 */
export type OpenClawEvidenceStrength = "weak" | "medium" | "strong";

/** adapter 采纳的证据类别。 */
export type OpenClawEvidenceKind =
  | "create.accepted"
  | "wait.running"
  | "wait.completed"
  | "wait.failed"
  | "wait.timeout"
  | "wait.waiting_approval"
  | "wait.ended_without_result"
  | "audit.blocked"
  | "audit.failed"
  | "audit.completed"
  | "task.blocked"
  | "task.failed"
  | "task.completed"
  | "history.negative_final_reply"
  | "local.cancel_ack"
  | "lanxin.terminal_latch"
  | "unknown";

/** OpenClaw tool/audit 层归一化结果。 */
export type OpenClawToolFindingStatus =
  | "succeeded"
  | "failed"
  | "blocked"
  | "timed_out"
  | "cancelled"
  | "unknown";

/** agent.wait 或兼容 wait-like 响应。 */
export interface OpenClawWaitEvidence {
  /** 原始 wait 状态；常见为 ok/error/timeout，也可能是 completed/failed 等兼容状态。 */
  status: string;
  /** run 开始时间；保留原始 number/string 形态。 */
  startedAt?: number | string;
  /** run 结束时间；存在时代表 lifecycle 已有终结证据。 */
  endedAt?: number | string;
  /** 停止原因。 */
  stopReason?: string;
  /** liveness 状态。 */
  livenessState?: string;
  /** timeout 所在阶段；wait-only timeout 不等于 run terminal timeout。 */
  timeoutPhase?: string;
  /** wait error 文本。 */
  error?: string;
}

/** lifecycle/audit 归一化终态线索。 */
export interface OpenClawLifecycleEvidence {
  /** lifecycle 开始时间；仅作审计/排序线索。 */
  startedAt?: number | string;
  /** lifecycle 结束时间；存在时可作为终态证据。 */
  endedAt?: number | string;
  /** lifecycle 终结阶段；未知新值保留原样。 */
  terminalPhase?: "end" | "error" | "timeout" | string;
  /** lifecycle 终结原因；可用于用户可见摘要。 */
  terminalReason?: string;
  /** audit 最高序号；用于合并多条 lifecycle 线索。 */
  highestSeq?: number;
}

/** audit/tool 调用结果线索。 */
export interface OpenClawToolFinding {
  /** OpenClaw tool call id；仅 adapter 内部关联。 */
  toolCallId?: string;
  /** OpenClaw tool 名称；仅 adapter 内部诊断。 */
  toolName?: string;
  /** tool/audit 归一化状态。 */
  status: OpenClawToolFindingStatus;
  /** tool/audit 错误码或原因码；不得含凭据。 */
  errorCode?: string;
  /** tool/audit 摘要；可投影为安全用户提示。 */
  summary?: string;
}

/** OpenClaw task ledger 线索，仅作补充。 */
export interface OpenClawTaskEvidence {
  /** OpenClaw task id；仅 adapter 内部关联。 */
  taskId?: string;
  /** task 当前状态；不同版本可能命名不同。 */
  status?: string;
  /** task 终局结果；存在时优先作为 task 证据。 */
  terminalOutcome?: string;
  /** task 进度摘要；可用于 job.progressSummary。 */
  progressSummary?: string;
  /** task 终局摘要；可用于终态回报。 */
  terminalSummary?: string;
  /** task 错误文本；不得含凭据。 */
  error?: string;
}

/** 最终回复/历史摘要，属于弱证据，只能辅助解释或阻塞识别。 */
export interface OpenClawFinalReplyEvidence {
  /** OpenClaw/assistant 最终回复文本；不得含凭据。 */
  text: string;
  /** 回复来源；用于判断证据强度。 */
  source: "event" | "history" | "wait-result";
  /** 回复可信度；弱证据不得单独判 completed。 */
  confidence: "weak" | "medium";
}

/** Gateway hello-ok 能力快照。 */
export interface OpenClawGatewayCapabilities {
  /** Gateway 协议版本；缺失时按未知能力处理。 */
  protocol?: number;
  /** hello-ok 声明的可调用 RPC 方法。 */
  methods: string[];
  /** hello-ok 声明的可订阅事件。 */
  events: string[];
}

/** 单次探针调用结果；失败探针不得直接抬升为业务失败。 */
export interface OpenClawProbeResult {
  /** 探针来源。 */
  source: "agent.wait" | "audit" | "task" | "history";
  /** 探针调用是否成功；失败只记录观测质量。 */
  ok: boolean;
  /** 探针观测时间 ISO-8601。 */
  observedAt: string;
  /** 成功时为方法名，失败时为错误码。 */
  status?: string;
  /** 探针失败文本；不得含凭据。 */
  error?: string;
}

/** 一次 adapter 状态裁决所需的 OpenClaw 证据集合。 */
export interface OpenClawExecutionEvidence {
  /** Lanxin job id；adapter 内部关联用，不进入 phone wire payload。 */
  jobId?: string;
  /** Lanxin affair id；adapter 内部关联用，不进入 phone wire payload。 */
  affairId?: string;
  /** OpenClaw run id。 */
  runId: string;
  /** OpenClaw session key；用于取消、history/task 对齐。 */
  sessionKey?: string;
  /** 证据采集时间 ISO-8601。 */
  observedAt: string;
  /** agent.wait 或 create 兼容响应。 */
  wait?: OpenClawWaitEvidence;
  /** lifecycle 终态线索。 */
  lifecycle?: OpenClawLifecycleEvidence;
  /** tool/audit 结构化结果。 */
  toolFindings: OpenClawToolFinding[];
  /** task ledger 结果。 */
  task?: OpenClawTaskEvidence;
  /** 用户可见最终回复。 */
  finalReply?: OpenClawFinalReplyEvidence;
  /** Gateway hello-ok 能力快照。 */
  gatewayCapabilities?: OpenClawGatewayCapabilities;
  /** 探针调用质量；失败探针不得直接裁决业务状态。 */
  probeResults?: OpenClawProbeResult[];
  /** 本地取消请求已收到 OpenClaw abort ack。 */
  localCancelAck?: boolean;
  /** 补充记录原始状态标签，便于审计。 */
  sourceStatuses?: string[];
}

/** 构造快照兼容证据的入参。 */
export interface BuildExecutionEvidenceInput {
  /** OpenClaw run id。 */
  runId: string;
  /** legacy runtime 快照状态。 */
  status: OpenClawRunStatus;
  /** legacy runtime 摘要；可转为弱 finalReply。 */
  summary?: string;
  /** legacy runtime 阻塞原因。 */
  blockedReason?: string | null;
  /** legacy runtime 恢复条件。 */
  resumeCondition?: string | null;
  /** Lanxin job id；仅 adapter 内部关联。 */
  jobId?: string;
  /** Lanxin affair id；仅 adapter 内部关联。 */
  affairId?: string;
  /** OpenClaw session key；仅 adapter 内部关联。 */
  sessionKey?: string | null;
  /** 观测时间；缺省为当前时间。 */
  observedAt?: string;
  /** 本地 cancel 已得到 runtime ack。 */
  localCancelAck?: boolean;
}

/**
 * 从旧 runtime snapshot 构造最小证据。
 *
 * @param input 快照字段与可选关联上下文
 * @returns 执行证据
 */
export function buildExecutionEvidence(input: BuildExecutionEvidenceInput): OpenClawExecutionEvidence {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const lifecycle = lifecycleEvidenceFromInput(input, observedAt);
  const finalReply = finalReplyFromInput(input);
  const evidence: OpenClawExecutionEvidence = {
    runId: input.runId,
    ...associationFromInput(input),
    observedAt,
    wait: waitEvidenceFromInput(input, observedAt),
    toolFindings: toolFindingsFromInput(input),
    sourceStatuses: [input.status],
  };
  if (lifecycle) {
    evidence.lifecycle = lifecycle;
  }
  if (finalReply) {
    evidence.finalReply = finalReply;
  }
  if (input.localCancelAck) {
    evidence.localCancelAck = true;
  }
  return evidence;
}

function associationFromInput(
  input: BuildExecutionEvidenceInput,
): Pick<OpenClawExecutionEvidence, "jobId" | "affairId" | "sessionKey"> {
  const association: Pick<OpenClawExecutionEvidence, "jobId" | "affairId" | "sessionKey"> = {};
  if (input.jobId) {
    association.jobId = input.jobId;
  }
  if (input.affairId) {
    association.affairId = input.affairId;
  }
  if (input.sessionKey) {
    association.sessionKey = input.sessionKey;
  }
  return association;
}

function waitEvidenceFromInput(
  input: BuildExecutionEvidenceInput,
  observedAt: string,
): OpenClawWaitEvidence {
  const wait: OpenClawWaitEvidence = { status: input.status };
  if (isTerminalStatus(input.status)) {
    wait.endedAt = observedAt;
  }
  if (input.status === "timed_out") {
    wait.timeoutPhase = "terminal";
  }
  return wait;
}

function lifecycleEvidenceFromInput(
  input: BuildExecutionEvidenceInput,
  observedAt: string,
): OpenClawLifecycleEvidence | undefined {
  if (!isTerminalStatus(input.status)) {
    return undefined;
  }
  const lifecycle: OpenClawLifecycleEvidence = {
    endedAt: observedAt,
    terminalPhase: terminalPhaseFromStatus(input.status),
  };
  if (input.summary) {
    lifecycle.terminalReason = input.summary;
  }
  return lifecycle;
}

function toolFindingsFromInput(input: BuildExecutionEvidenceInput): OpenClawToolFinding[] {
  if (input.status === "blocked") {
    return [{ status: "blocked", summary: input.blockedReason ?? input.summary ?? "openclaw_blocked" }];
  }
  if (input.status === "failed" || input.status === "timed_out") {
    return [{
      status: input.status === "timed_out" ? "timed_out" : "failed",
      summary: input.summary ?? input.blockedReason ?? input.status,
    }];
  }
  return [];
}

function finalReplyFromInput(input: BuildExecutionEvidenceInput): OpenClawFinalReplyEvidence | undefined {
  if (!input.summary) {
    return undefined;
  }
  return {
    text: input.summary,
    source: "wait-result",
    confidence: "weak",
  };
}

function terminalPhaseFromStatus(
  status: OpenClawRunStatus,
): NonNullable<OpenClawLifecycleEvidence["terminalPhase"]> {
  if (status === "timed_out") {
    return "timeout";
  }
  return status === "failed" ? "error" : "end";
}

function isTerminalStatus(status: OpenClawRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "timed_out";
}
