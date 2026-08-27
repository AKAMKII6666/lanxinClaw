/**
 * 自带 OpenClaw 入口解析。
 *
 * 职责：从显式参数、环境变量、打包资源和开发期常见目录解析 openclaw.mjs。
 * 不拥有：启动 Gateway、模型配置、用户凭据。
 * 副作用：只读检查文件是否存在。
 */

import fs from "node:fs";
import path from "node:path";

/** 入口解析输入 */
export interface ResolveBundledOpenClawEntryInput {
  /** 显式传入入口 */
  explicit?: string | null;
  /** 环境变量入口 */
  envEntry?: string | null;
  /** Electron app path */
  appPath?: string | null;
  /** Electron resources path */
  resourcesPath?: string | null;
  /** 当前工作目录 */
  cwd?: string;
}

/**
 * 解析随产品携带的 OpenClaw 入口；不存在时返回空字符串。
 *
 * @param input 输入
 * @returns 可执行入口路径或空字符串
 */
export function resolveBundledOpenClawEntry(input: ResolveBundledOpenClawEntryInput): string {
  const candidates = [
    input.explicit,
    input.envEntry,
    input.resourcesPath ? path.join(input.resourcesPath, "openclaw", "openclaw.mjs") : null,
    input.resourcesPath ? path.join(input.resourcesPath, "app", "openclaw", "openclaw.mjs") : null,
    input.appPath ? path.join(input.appPath, "openclaw", "openclaw.mjs") : null,
    input.appPath ? path.join(input.appPath, "vendor", "openclaw", "openclaw.mjs") : null,
    ...ancestorCandidates(input.cwd ?? process.cwd()),
  ];
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized && fs.existsSync(normalized)) {
      return normalized;
    }
  }
  return "";
}

function ancestorCandidates(start: string): string[] {
  const result: string[] = [];
  let current = path.resolve(start);
  for (;;) {
    result.push(path.join(current, "openclaw", "openclaw.mjs"));
    result.push(path.join(current, "vendor", "openclaw", "openclaw.mjs"));
    const parent = path.dirname(current);
    if (parent === current) {
      return result;
    }
    current = parent;
  }
}
