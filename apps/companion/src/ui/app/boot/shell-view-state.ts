/**
 * 壳启动视图状态机辅助。
 *
 * 职责：bootstrap 结果到视图状态的映射。
 * 不拥有：IPC 调用本身。
 * 纯函数：无副作用。
 */

import type { OnboardingPhase, OnboardingSubmitResult } from "../../../bridge/contract.js";

/** 壳视图 */
export type ShellView =
  | { kind: "loading" }
  | { kind: "config" }
  | { kind: "bootstrap"; phase: OnboardingPhase; error: string | null }
  | { kind: "main" };

/**
 * 根据 bootstrap 结果生成下一视图。
 *
 * @param result IPC 结果
 * @returns 下一视图
 */
export function viewAfterBootstrap(result: OnboardingSubmitResult): ShellView {
  if (!result.ok) {
    return {
      kind: "bootstrap",
      phase: "starting_runtime",
      error: result.error?.message ?? "运行时启动失败，请重试",
    };
  }
  return { kind: "main" };
}

/**
 * bootstrap 抛错时的视图。
 *
 * @returns 错误视图
 */
export function viewAfterBootstrapThrow(): ShellView {
  return {
    kind: "bootstrap",
    phase: "starting_runtime",
    error: "主进程未响应，请重启 Companion 后重试",
  };
}
