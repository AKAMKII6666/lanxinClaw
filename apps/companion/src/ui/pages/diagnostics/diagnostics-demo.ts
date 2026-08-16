/**
 * 诊断页演示报告（真实 probe 接入前的安全占位）。
 *
 * 职责：组装服务/环境检查、最近错误与可复制摘要。
 * 不拥有：真实 OS/网络探测、凭据读写、自动修复。
 * 纯函数：返回静态结构；不含 API key / pairingSecret 明文。
 */

import { PROTOCOL_VERSION } from "@lanxin-claw/protocol";
import {
  createDemoEnvironmentProbes,
  createDemoServiceProbes,
} from "./diagnostics-demo-probes.js";
import type { DiagnosticReportView } from "./diagnostics-models.js";

/**
 * 构造诊断页演示报告。
 *
 * @returns 可渲染且无秘密的诊断视图
 */
export function createDemoDiagnosticReport(): DiagnosticReportView {
  return {
    schemaVersion: PROTOCOL_VERSION,
    reportId: "ui_diag_companion_demo",
    generatedAt: "2026-07-23T01:00:00.000Z",
    overallStatus: "warn",
    services: createDemoServiceProbes(),
    environment: createDemoEnvironmentProbes(),
    lastError: {
      occurredAt: "2026-07-22T21:08:00.000Z",
      code: "job.blocked",
      severity: "error",
      message: "无法访问 npm registry",
      affairId: "affair_fix_code_001",
      jobId: "job_fix_code_001",
      retryable: true,
    },
    copyText:
      "overall=warn; companion=ok; openclaw=ok; credential=synced; lan_discovery=warn; firewall=warn; lastError=job.blocked",
  };
}
