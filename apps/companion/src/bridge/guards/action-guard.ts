/**
 * Bridge UI 操作白名单校验。
 *
 * 职责：判断 renderer 提交的 action 是否为已知安全形状。
 * 不拥有：权限裁决、副作用执行、Electron IPC。
 * 纯函数：无 I/O。
 */

import type { BridgeNavPage, BridgeUiAction } from "../contract.js";

const NAV_PAGES = new Set<string>([
  "overview",
  "tasks",
  "zhang-boss",
  "permissions",
  "diagnostics",
]);

const SIMPLE_ACTION_TYPES = new Set<string>([
  "clawCore.restart",
  "clawCore.openDiagnostics",
  "companion.restart",
  "credential.requestSync",
  "credential.requestReauth",
  "device.requestPairing",
  "pairing.rescan",
  "diagnostics.openLogs",
  "zhangBoss.openChat",
]);

const AFFAIR_ID_ACTION_TYPES = new Set<string>([
  "affair.viewDetail",
  "affair.pause",
  "affair.resume",
  "affair.cancel",
  "affair.accept",
  "affair.requestRevision",
  "affair.requestAcceptance",
]);

const PERMISSION_DECISIONS = new Set<string>([
  "allow_once",
  "allow_for_job",
  "deny",
  "require_more_context",
]);

const PAIRING_DECIDE_TYPES = new Set<string>(["pairing.approve", "pairing.reject"]);

const CHAT_ATTACH_TARGETS = new Set(["active_call", "affair"]);
const CHAT_CONTENT_KINDS = new Set(["path", "log", "url", "note"]);

/** 解析后的候选 action 字段 */
type ActionCandidate = {
  type?: unknown;
  page?: unknown;
  affairId?: unknown;
  phoneDeviceId?: unknown;
  desktopDeviceId?: unknown;
  permissionRequestId?: unknown;
  decision?: unknown;
  pairingId?: unknown;
  text?: unknown;
  target?: unknown;
  contentKind?: unknown;
  enabled?: unknown;
  url?: unknown;
};

/**
 * 校验 navigate 操作。
 *
 * @param page 页面候选
 * @returns 是否合法
 */
function isNavigateAction(page: unknown): page is BridgeNavPage {
  return typeof page === "string" && NAV_PAGES.has(page);
}

/**
 * 校验带 affairId 的操作。
 *
 * @param type 操作类型
 * @param affairId 事务 id
 * @returns 是否合法
 */
function isAffairIdAction(type: string, affairId: unknown): boolean {
  return AFFAIR_ID_ACTION_TYPES.has(type) && typeof affairId === "string";
}

/**
 * 校验设备断开/撤销操作。
 *
 * @param typed 候选字段
 * @returns 是否合法
 */
function isDeviceAction(typed: ActionCandidate): boolean {
  if (typed.type === "device.disconnect") {
    return typeof typed.phoneDeviceId === "string";
  }
  if (typed.type === "device.revokePairing") {
    return typeof typed.phoneDeviceId === "string" && typeof typed.desktopDeviceId === "string";
  }
  return false;
}

/**
 * 校验权限决策操作。
 *
 * @param typed 候选字段
 * @returns 是否合法
 */
function isPermissionDecideAction(typed: ActionCandidate): boolean {
  return (
    typed.type === "permission.decide" &&
    typeof typed.permissionRequestId === "string" &&
    typeof typed.decision === "string" &&
    PERMISSION_DECISIONS.has(typed.decision)
  );
}

/**
 * 校验配对允许/拒绝操作。
 *
 * @param typed 候选字段
 * @returns 是否合法
 */
function isPairingDecideAction(typed: ActionCandidate): boolean {
  return (
    typeof typed.type === "string" &&
    PAIRING_DECIDE_TYPES.has(typed.type) &&
    typeof typed.pairingId === "string"
  );
}

/**
 * 校验 chat 提交操作；text 为 untrusted，不得当系统指令。
 *
 * @param typed 候选字段
 * @returns 是否合法
 */
function isChatAction(typed: ActionCandidate): boolean {
  if (typed.type === "chat.sendMessage") {
    return typeof typed.text === "string" && typed.text.trim().length > 0;
  }
  if (typed.type === "chat.attachContext") {
    return (
      typeof typed.text === "string" &&
      typed.text.trim().length > 0 &&
      typeof typed.target === "string" &&
      CHAT_ATTACH_TARGETS.has(typed.target) &&
      typeof typed.contentKind === "string" &&
      CHAT_CONTENT_KINDS.has(typed.contentKind) &&
      (typed.target !== "affair" ||
        (typeof typed.affairId === "string" && typed.affairId.length > 0))
    );
  }
  return false;
}

/**
 * 校验浏览器代理设置。
 *
 * @param typed 候选字段
 * @returns 是否合法
 */
function isBrowserProxySettingsAction(typed: ActionCandidate): boolean {
  return (
    typed.type === "settings.setBrowserProxy" &&
    typeof typed.enabled === "boolean" &&
    typeof typed.url === "string"
  );
}

/**
 * 校验带 payload 的复合白名单操作。
 *
 * @param typed 已确认含 type 字符串的候选
 * @returns 是否匹配
 */
function matchesPayloadAction(typed: ActionCandidate & { type: string }): boolean {
  if (typed.type === "navigate") {
    return isNavigateAction(typed.page);
  }
  return (
    isAffairIdAction(typed.type, typed.affairId) ||
    isDeviceAction(typed) ||
    isPermissionDecideAction(typed) ||
    isPairingDecideAction(typed) ||
    isChatAction(typed) ||
    isBrowserProxySettingsAction(typed)
  );
}

/**
 * 判断是否为已知安全 action。
 *
 * @param action 候选操作
 * @returns 是否可路由
 */
export function isAllowedBridgeAction(action: unknown): action is BridgeUiAction {
  if (!action || typeof action !== "object") {
    return false;
  }
  const typed = action as ActionCandidate;
  if (typeof typed.type !== "string") {
    return false;
  }
  return matchesPayloadAction(typed as ActionCandidate & { type: string }) || SIMPLE_ACTION_TYPES.has(typed.type);
}
