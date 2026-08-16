/**
 * 诊断页演示 probe 数据片段。
 *
 * 职责：拆出服务/环境 probe 列表，缩短 createDemoDiagnosticReport。
 * 不拥有：真实探测。
 * 纯函数：返回静态数组。
 */

import type { DiagnosticProbeView } from "./diagnostics-models.js";

/**
 * @returns 演示服务 probe
 */
export function createDemoServiceProbes(): DiagnosticProbeView[] {
  return [
    {
      probeId: "companion.service",
      label: "Companion service",
      category: "service",
      status: "ok",
      detail: "running；version=0.1.0-dev",
      hint: null,
    },
    {
      probeId: "openclaw.core",
      label: "OpenClaw core",
      category: "service",
      status: "ok",
      detail: "adapterReady=false；runtime 尚未接入真实 worker",
      hint: "后续批次接入 OpenClaw adapter 后再复测",
    },
    {
      probeId: "credential.api",
      label: "API key 配置态",
      category: "service",
      status: "ok",
      detail: "provider=openclaw-api；status=synced（仅配置态，界面不接触明文）",
      hint: null,
    },
    {
      probeId: "secure.storage",
      label: "Secure storage",
      category: "service",
      status: "ok",
      detail: "os keychain reachable",
      hint: null,
    },
  ];
}

/**
 * @returns 演示环境 probe（含 LAN / firewall）
 */
export function createDemoEnvironmentProbes(): DiagnosticProbeView[] {
  return [
    {
      probeId: "env.node",
      label: "Node",
      category: "environment",
      status: "ok",
      detail: ">=20 available",
      hint: null,
    },
    {
      probeId: "env.package_manager",
      label: "Package manager",
      category: "environment",
      status: "ok",
      detail: "npm available",
      hint: null,
    },
    {
      probeId: "env.git",
      label: "Git",
      category: "environment",
      status: "ok",
      detail: "git available",
      hint: null,
    },
    {
      probeId: "net.lan_discovery",
      label: "LAN discovery",
      category: "environment",
      status: "warn",
      detail: "mDNS 可能被防火墙拦截",
      hint: "检查防火墙是否放行 mDNS / 本机 companion 端口",
    },
    {
      probeId: "net.firewall",
      label: "Firewall",
      category: "environment",
      status: "warn",
      detail: "本机防火墙规则未确认",
      hint: "确认 companion 监听端口未被阻止",
    },
  ];
}
