/**
 * Gateway 启动入参等价比较（配置热更新门闩）。
 *
 * 职责：判断 ensureStarted 是否可复用现有进程。
 * 不拥有：进程管理、密钥落盘。
 * 纯函数。
 */

import type { StartGatewayRuntimeInput } from "./service.js";

/**
 * 两份启动入参是否语义等价（含工具开关与 key 变更）。
 *
 * @param left 已运行配置
 * @param right 新入参
 * @returns 是否可复用现有 gateway
 */
export function sameGatewayRuntimeInput(
  left: StartGatewayRuntimeInput | null | undefined,
  right: StartGatewayRuntimeInput,
): boolean {
  if (!left) {
    return false;
  }
  const pairs: Array<[string | boolean | null | undefined, string | boolean | null | undefined]> = [
    [left.provider, right.provider],
    [left.endpoint ?? null, right.endpoint ?? null],
    [left.modelRef, right.modelRef],
    [left.workspace, right.workspace],
    [Boolean(left.enableWebSearch), Boolean(right.enableWebSearch)],
    [Boolean(left.enableBrowser), Boolean(right.enableBrowser)],
    [left.apiKey, right.apiKey],
    [left.webSearchApiKey ?? "", right.webSearchApiKey ?? ""],
    [Boolean(left.browserProxyEnabled), Boolean(right.browserProxyEnabled)],
    [left.browserProxyUrl ?? "", right.browserProxyUrl ?? ""],
  ];
  return pairs.every(([a, b]) => a === b);
}
