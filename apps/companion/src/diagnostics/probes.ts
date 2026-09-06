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
  /** protocol server 是否监听 */
  protocolServerReady?: boolean;
  /** Gateway URL；空表示未配置 */
  gatewayUrl?: string | null;
  /** Gateway 是否就绪 */
  gatewayReady?: boolean;
  /** LAN discovery 是否启用 */
  lanDiscoveryReady?: boolean;
  /** secure storage 是否可用 */
  secureStorageReady?: boolean;
  /** 最近 protocol/server 错误码 */
  recentServerErrorCode?: string | null;
  /** 最近错误 */
  lastError?: DiagnosticReportView["lastError"];
  /** OpenClaw web_search 是否 ready（配置级） */
  openClawWebSearchReady?: boolean;
  /** OpenClaw browser 是否 ready（配置级） */
  openClawBrowserReady?: boolean;
  /** OpenClaw 能力摘要文案；无密钥 */
  openClawCapabilityDetail?: string | null;
}

/**
 * 构建诊断报告。
 *
 * @param input 输入
 * @returns 报告
 */
export function buildDiagnosticReport(input: BuildDiagnosticReportInput = {}): DiagnosticReportView {
  const services = [
    probe(
      "companion.service",
      "Companion service",
      "service",
      input.protocolServerReady === false ? "warn" : "ok",
      input.protocolServerReady === false ? "protocol server not listening" : "running",
      input.protocolServerReady === false ? "启动 desktop protocol server 后重试" : null,
    ),
    probe(
      "openclaw.gateway",
      "OpenClaw Gateway",
      "service",
      input.gatewayReady ? "ok" : "warn",
      gatewayDetail(input),
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
    ...openClawToolProbes(input),
  ] satisfies DiagnosticProbeView[];
  if (input.recentServerErrorCode) {
    services.push(probe(
      "server.recent_error",
      "Recent server error",
      "service",
      "warn",
      input.recentServerErrorCode,
      "查看 companion 日志定位最近协议或运行时错误",
    ));
  }
  const overallStatus = summarizeOverallStatus([...services, ...environment]);
  return {
    schemaVersion: "0.1",
    reportId: `diag_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    overallStatus,
    services,
    environment,
    lastError: input.lastError ?? null,
    copyText: `overall=${overallStatus}; protocol=${input.protocolServerReady === false ? "warn" : "ok"}; gateway=${input.gatewayReady ? "ok" : "warn"}; node=${process.version}`,
  };
}

function gatewayDetail(input: BuildDiagnosticReportInput): string {
  if (input.gatewayReady) {
    return `ready ${input.gatewayUrl ?? ""}`.trim();
  }
  return input.gatewayUrl ? "configured but not ready" : "missing gateway url";
}

function summarizeOverallStatus(items: readonly DiagnosticProbeView[]): DiagnosticReportView["overallStatus"] {
  if (items.some((item) => item.status === "error")) {
    return "error";
  }
  if (items.some((item) => item.status === "warn" || item.status === "unknown")) {
    return "warn";
  }
  return "ok";
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
 * OpenClaw 工具能力探针（从主报告拆出以降复杂度）。
 *
 * @param input 诊断输入
 * @returns probes
 */
function openClawToolProbes(input: BuildDiagnosticReportInput): DiagnosticProbeView[] {
  const searchDetail = input.openClawWebSearchReady
    ? input.openClawCapabilityDetail ?? "ready"
    : "not configured";
  return [
    probe(
      "openclaw.web_search",
      "OpenClaw web_search",
      "environment",
      input.openClawWebSearchReady ? "ok" : "warn",
      searchDetail,
      input.openClawWebSearchReady ? null : "在 onboarding 勾选网页能力并配置搜索 key 后重试",
    ),
    probe(
      "openclaw.browser",
      "OpenClaw browser",
      "environment",
      input.openClawBrowserReady ? "ok" : "warn",
      input.openClawBrowserReady ? "ready" : "not configured",
      input.openClawBrowserReady ? null : "在 onboarding 勾选浏览器能力后重试；每次 job 仍需 companion 授权",
    ),
  ];
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
