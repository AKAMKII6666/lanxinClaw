/**
 * 诊断页文案映射。
 *
 * 职责：probe / overall / 错误严重级别 → 中文标签。
 * 不拥有：真实探测、bridge。
 * 纯函数：仅映射。
 */

import type { DiagnosticOverallStatus, ProbeStatus } from "./diagnostics-models.js";

/** probe 状态文案 */
export const PROBE_STATUS_LABEL: Record<ProbeStatus, string> = {
  ok: "正常",
  warn: "警告",
  error: "异常",
  unknown: "未知",
};

/** 报告总体态文案 */
export const OVERALL_STATUS_LABEL: Record<DiagnosticOverallStatus, string> = {
  ok: "整体正常",
  warn: "存在警告",
  error: "存在异常",
};

/**
 * @param map 映射表
 * @param key 键
 * @returns 标签或原文
 */
export function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
