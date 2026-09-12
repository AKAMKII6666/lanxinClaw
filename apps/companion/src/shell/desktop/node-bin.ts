/**
 * 自托管 OpenClaw 的 Node 运行时解析。
 *
 * 职责：避免 Electron 主进程把 process.execPath（electron.exe）误当 node 使用。
 * 不拥有：OpenClaw 配置、模型凭据、运行时进程生命周期。
 */

import fs from "node:fs";
import path from "node:path";

/** Node 运行时解析入参 */
export interface ResolveOpenClawNodeBinInput {
  /** 显式覆盖，如测试或安装包注入的 Node 路径 */
  explicit?: string | null;
  /** 环境变量覆盖 */
  envNodeBin?: string | null;
  /** Electron resourcesPath，用于打包后寻找随包 Node */
  resourcesPath?: string | null;
  /** 当前进程可执行文件 */
  execPath: string;
}

/**
 * 解析用于启动 OpenClaw 子进程的 Node 可执行文件。
 *
 * @param input 入参
 * @returns Node 可执行文件或 PATH 命令
 */
export function resolveOpenClawNodeBin(input: ResolveOpenClawNodeBinInput): string {
  const explicit = firstExistingFile(input.explicit);
  if (explicit) {
    return explicit;
  }
  const envNodeBin = firstExistingFile(input.envNodeBin);
  if (envNodeBin) {
    return envNodeBin;
  }
  for (const candidate of bundledNodeCandidates(input.resourcesPath)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const execName = path.basename(input.execPath).toLowerCase();
  if (execName === "electron.exe" || execName === "electron") {
    return process.platform === "win32" ? "node.exe" : "node";
  }
  return input.execPath;
}

function firstExistingFile(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return fs.existsSync(trimmed) ? trimmed : null;
}

function bundledNodeCandidates(resourcesPath: string | null | undefined): string[] {
  if (!resourcesPath) {
    return [];
  }
  const exe = process.platform === "win32" ? "node.exe" : "node";
  return [
    path.join(resourcesPath, "node", exe),
    path.join(resourcesPath, "bin", exe),
    path.join(resourcesPath, "app", "node", exe),
  ];
}
