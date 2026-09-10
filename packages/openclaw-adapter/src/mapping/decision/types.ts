/** 职责：证据裁决的输入、规则和结果类型。不拥有：运行时与状态提交。纯类型，无副作用。 */
import type { JobEvidenceQuality, JobRecentStep, JobStatus } from "@lanxin-claw/protocol";
import type {
OpenClawEvidenceKind,
OpenClawEvidenceStrength,
OpenClawExecutionEvidence,
} from "../../evidence/openclaw-execution-evidence.js";
import type { AdapterJobRecord } from "../../jobs/job-types.js";
import type { OpenClawRunStatus } from "../../status/openclaw-run-status.js";
import {
type TaskOutcome
} from "./evidence-helpers.js";


/** 裁决结果；只进入 adapter store，公开协议只投影安全字段。 */
export interface OpenClawToLanxinJobDecision {
  /** Lanxin job 状态。 */
  status: JobStatus;
  /** 用户可见进度或终态摘要。 */
  progressSummary: string;
  /** 用户可见阻塞原因；非阻塞可为 null。 */
  blockedReason: string | null;
  /** 用户可恢复条件；不可恢复或无需恢复可为 null。 */
  resumeCondition: string | null;
  /** 稳定理由码；供 companion/phone 精准回报。 */
  statusReasonCode: string;
  /** 证据观测时间 ISO-8601。 */
  statusObservedAt: string;
  /** 触发裁决的主要证据类别。 */
  evidenceKind: OpenClawEvidenceKind;
  /** 触发裁决的主要证据强度。 */
  evidenceStrength: OpenClawEvidenceStrength;
  /** OpenClaw 原始归一化状态；未知则为 null。 */
  rawRunStatus: string | null;
  /** 最近执行步骤投影；最多 8 条。 */
  recentSteps: JobRecentStep[];
  /** 终态可验收摘要；低信号时为 null。 */
  resultDigest: string | null;
  /** 证据质量；由 adapter 生成，phone 只用于回报提示。 */
  evidenceQuality: JobEvidenceQuality;
}

/** 单次裁决共享的只读输入。 */
export interface DecisionContext {
  /** 当前 job。 */
  job: AdapterJobRecord;
  /** 执行证据。 */
  evidence: OpenClawExecutionEvidence;
  /** 归一化运行状态。 */
  rawRunStatus: OpenClawRunStatus | null;
  /** task 结果粗分类。 */
  taskOutcome: TaskOutcome;
}

/** 规则返回 null 表示继续检查下一条规则。 */
export type DecisionRule = (context: DecisionContext) => OpenClawToLanxinJobDecision | null;
