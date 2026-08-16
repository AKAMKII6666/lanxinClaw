/**
 * 诊断页经 bridge 提交的操作意图常量。
 *
 * 职责：固定「重启 Companion / 打开日志」等 type，避免文案与 worker 重启混淆。
 * 不拥有：真实重启、打开日志目录、权限裁决。
 * 纯函数：仅常量；无 I/O。
 */

import type { BridgeUiAction } from "../../../bridge/contract.js";

/**
 * 诊断页「重启 Companion」对应的 bridge 意图。
 * 与 clawCore.restart（OpenClaw worker）刻意分离，避免信任边界混淆。
 */
export const DIAGNOSTICS_RESTART_COMPANION_ACTION = {
  type: "companion.restart",
} as const satisfies BridgeUiAction;
