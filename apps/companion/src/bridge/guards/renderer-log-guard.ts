/**
 * renderer 日志条目白名单校验。
 *
 * 职责：限制 renderer 只能上报 ui 模块、白名单级别与受限长度/深度。
 * 不拥有：日志写入、Electron IPC。
 * 纯函数：无 I/O。
 */

import {
  RENDERER_LOG_LEVELS,
  RENDERER_LOG_MAX_MESSAGE_LENGTH,
  RENDERER_LOG_MAX_META_DEPTH,
  type BridgeError,
  type RendererLogEntry,
  type RendererLogLevel,
} from "../contract.js";

/**
 * 校验 renderer 日志条目。
 *
 * @param entry 候选条目
 * @returns 合法或错误
 */
export function validateRendererLogEntry(
  entry: unknown,
): { ok: true; value: RendererLogEntry } | { ok: false; error: BridgeError } {
  if (!entry || typeof entry !== "object") {
    return logError("bridge_log_invalid", "日志条目格式无效", false);
  }
  const typed = entry as { module?: unknown; level?: unknown; message?: unknown; meta?: unknown };
  return validateShape(typed);
}

/**
 * 校验已确认是对象的日志条目。
 *
 * @param typed 候选
 * @returns 合法或错误
 */
function validateShape(typed: {
  module?: unknown;
  level?: unknown;
  message?: unknown;
  meta?: unknown;
}): { ok: true; value: RendererLogEntry } | { ok: false; error: BridgeError } {
  if (typed.module !== "ui") {
    return logError("bridge_log_module_rejected", "renderer 只能上报 ui 模块日志", false);
  }
  if (!isAllowedLevel(typed.level)) {
    return logError("bridge_log_level_rejected", "日志级别不在白名单", false);
  }
  if (!isValidMessage(typed.message)) {
    return logError("bridge_log_invalid", "日志缺少 message", false);
  }
  if ((typed.message as string).length > RENDERER_LOG_MAX_MESSAGE_LENGTH) {
    return logError(
      "bridge_log_too_long",
      `日志 message 超过 ${RENDERER_LOG_MAX_MESSAGE_LENGTH} 字符`,
      false,
    );
  }
  if (typed.meta !== undefined && !isShallowEnough(typed.meta, RENDERER_LOG_MAX_META_DEPTH)) {
    return logError(
      "bridge_log_meta_too_deep",
      `日志 meta 深度超过 ${RENDERER_LOG_MAX_META_DEPTH}`,
      false,
    );
  }
  return {
    ok: true,
    value: {
      module: "ui",
      level: typed.level as RendererLogLevel,
      message: typed.message as string,
      ...(typed.meta !== undefined ? { meta: typed.meta } : {}),
    },
  };
}

/**
 * @param level 候选级别
 * @returns 是否白名单内
 */
function isAllowedLevel(level: unknown): level is RendererLogLevel {
  return typeof level === "string" && (RENDERER_LOG_LEVELS as readonly string[]).includes(level);
}

/**
 * @param message 候选文本
 * @returns 是否非空字符串
 */
function isValidMessage(message: unknown): message is string {
  return typeof message === "string" && message.trim().length > 0;
}

/**
 * @param value 候选 meta
 * @param maxDepth 最大嵌套深度
 * @param current 当前深度
 * @returns 是否深度合规（对象深度超过 maxDepth 视为不合规；标量不限）
 */
function isShallowEnough(value: unknown, maxDepth: number, current = 0): boolean {
  if (value === null || typeof value !== "object") {
    return true;
  }
  if (current >= maxDepth) {
    return false;
  }
  const next = current + 1;
  if (Array.isArray(value)) {
    return value.every((item) => isShallowEnough(item, maxDepth, next));
  }
  return Object.values(value).every((item) => isShallowEnough(item, maxDepth, next));
}

/**
 * 构造校验错误。
 *
 * @param code 错误码
 * @param message 说明
 * @param retryable 是否可重试
 * @returns 错误结果
 */
function logError(
  code: string,
  message: string,
  retryable: boolean,
): { ok: false; error: BridgeError } {
  return { ok: false, error: { code, message, retryable } };
}
