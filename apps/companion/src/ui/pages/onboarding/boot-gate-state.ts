/**
 * 壳启动分流纯函数。
 *
 * 职责：根据 onboarding 状态决定配置门 / 冷启动 / 主界面。
 * 不拥有：IPC、gateway 启动。
 * 纯函数：无副作用。
 */

/** 壳启动目标 */
export type ShellBootTarget = "loading" | "config" | "bootstrap" | "main";

/**
 * 根据 onboarding status 决定启动目标。
 *
 * @param status onboarding 状态；null 表示尚未拉取
 * @returns 启动目标
 */
export function resolveShellBootTarget(
  status: "unconfigured" | "configuring" | "ready" | "failed" | null,
): ShellBootTarget {
  if (status === null) {
    return "loading";
  }
  if (status === "ready") {
    return "bootstrap";
  }
  return "config";
}
