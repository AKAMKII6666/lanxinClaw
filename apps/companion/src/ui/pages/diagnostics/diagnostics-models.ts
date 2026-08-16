/**
 * 诊断页视图模型（对齐控制面板 diagnostic report 契约）。
 *
 * 职责：描述 probe、最近错误与可复制报告文本的展示形状。
 * 不拥有：真实 environment probe、凭据明文、日志目录打开。
 * 纯函数：仅类型；不得含 API key / pairingSecret。
 */

/** probe 健康态 */
export type ProbeStatus = "ok" | "warn" | "error" | "unknown";

/** 报告总体态 */
export type DiagnosticOverallStatus = "ok" | "warn" | "error";

/**
 * 单项服务或环境检查。
 */
export interface DiagnosticProbeView {
  /** probe 稳定 id */
  probeId: string;
  /** 展示标签 */
  label: string;
  /** 分类：服务或环境 */
  category: "service" | "environment";
  /** 检查结果态 */
  status: ProbeStatus;
  /** 详情摘要；不得含凭据明文 */
  detail: string;
  /** 用户可操作提示；可空 */
  hint: string | null;
}

/**
 * 最近错误摘要；worker completed 不得写成 affair closed。
 */
export interface DiagnosticLastErrorView {
  /** 发生时间 ISO-8601 */
  occurredAt: string;
  /** 稳定错误码，如 job.blocked */
  code: string;
  /** 严重级别 */
  severity: string;
  /** 用户可读说明 */
  message: string;
  /** 关联事务；可空 */
  affairId: string | null;
  /** 关联 job；可空 */
  jobId: string | null;
  /** 是否可重试 */
  retryable: boolean;
}

/**
 * 诊断页聚合报告。
 */
export interface DiagnosticReportView {
  /** 契约版本 */
  schemaVersion: string;
  /** 报告 id */
  reportId: string;
  /** 生成时间 */
  generatedAt: string;
  /** 总体态 */
  overallStatus: DiagnosticOverallStatus;
  /** 服务类 probe */
  services: DiagnosticProbeView[];
  /** 环境类 probe（含 LAN / firewall / Node 等） */
  environment: DiagnosticProbeView[];
  /** 最近错误；无则为 null */
  lastError: DiagnosticLastErrorView | null;
  /** 供「复制诊断报告」的纯文本；不得含 key 明文 */
  copyText: string;
}
