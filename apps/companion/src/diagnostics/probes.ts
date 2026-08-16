/**
 * 真实诊断 probe。
 *
 * 职责：生成 companion / Gateway / Node / Git / LAN / secure storage 的安全诊断摘要。
 * 不拥有：UI 渲染、凭据明文、Gateway run 创建。
 * 副作用：读取进程版本、可选执行只读 git --version。
 */

import { execFileSync } from "node:child_process";
import type { DiagnosticReportView, DiagnosticProbeView } from "../ui/pages/diagnostics/diagnostics-models.js";

/**
 * 诊断输入。
 */
export interface BuildDiagnosticReportInput {
  /** Gateway URL；空表示未配置 */
  gatewayUrl?: string | null;
  /** Gateway 是否就绪 */
  gatewayReady?: boolean;
  /** LAN discovery 是否启用 */
  lanDiscoveryReady?: boolean;
  /** secure storage 是否可用 */
  secureStorageReady?: boolean;
  /** 最近错误 */
  lastError?: DiagnosticReportView["lastError"];
}

/**
 * 构建诊断报告。
 *
 * @param input 输入
 * @returns 报告
 */
export function buildDiagnosticReport(input: BuildDiagnosticReportInput = {}): DiagnosticReportView {
  const services = [
    probe("companion.service", "Companion service", "service", "ok", "running", null),
    probe(
      "openclaw.gateway",
      "OpenClaw Gateway",
      "service",
      input.gatewayReady ? "ok" : "warn",
      input.gatewayUrl ? "configured" : "missing gateway url",
      input.gatewayReady ? null : "配置并启动 OpenClaw Gateway 后重试",
    ),
    probe(
      "secure.storage",
      "Secure storage",
      "service",
      input.secureStorageReady ? "ok" : "warn",
      input.secureStorageReady ? "available" : "not configured",
      "当前只显示凭据状态，不暴露明文",
    ),
  ] satisfies DiagnosticProbeView[];
  const environment = [
    probe("env.node", "Node", "environment", "ok", process.version, null),
    probe("env.git", "Git", "environment", gitStatus(), gitDetail(), null),
    probe(
      "net.lan_discovery",
      "LAN discovery",
      "environment",
      input.lanDiscoveryReady ? "ok" : "warn",
      input.lanDiscoveryReady ? "ready" : "not verified",
      "真实电话联调前需确认局域网发现",
    ),
  ] satisfies DiagnosticProbeView[];
  const overallStatus = services.some((item) => item.status === "error") ? "error" : "warn";
  return {
    schemaVersion: "0.1",
    reportId: `diag_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    overallStatus,
    services,
    environment,
    lastError: input.lastError ?? null,
    copyText: `overall=${overallStatus}; gateway=${input.gatewayReady ? "ok" : "warn"}; node=${process.version}`,
  };
}

/**
 * 创建 probe。
 */
function probe(
  probeId: string,
  label: string,
  category: "service" | "environment",
  status: DiagnosticProbeView["status"],
  detail: string,
  hint: string | null,
): DiagnosticProbeView {
  return { probeId, label, category, status, detail, hint };
}

/**
 * @returns git 状态
 */
function gitStatus(): DiagnosticProbeView["status"] {
  return gitDetail() === "git unavailable" ? "warn" : "ok";
}

/**
 * @returns git 版本摘要
 */
function gitDetail(): string {
  try {
    return execFileSync("git", ["--version"], { encoding: "utf8", timeout: 2000 }).trim();
  } catch {
    return "git unavailable";
  }
}

