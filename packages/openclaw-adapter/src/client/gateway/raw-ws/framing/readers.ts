/**
 * Gateway framing/payload 宽容读取工具。
 *
 * 职责：从不同版本的 Gateway JSON 里读取少量安全字段。
 * 不拥有：RPC、状态裁决、Lanxin 协议投影。
 * 纯函数：无 I/O。
 */

/**
 * 读取字符串字段。
 *
 * @param raw 对象
 * @param keys 候选键
 * @returns 值或 null
 */
export function readString(raw: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (typeof raw[key] === "string" && raw[key].trim()) {
      return raw[key] as string;
    }
  }
  return null;
}

/**
 * 宽松读取文本字段；支持 string、对象 text/content 与 content parts 数组。
 *
 * @param raw 对象
 * @param keys 候选键
 * @returns 合并后的文本或 null
 */
export function readTextLike(raw: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const text = textFromUnknown(raw[key], 0);
    if (text) {
      return text;
    }
  }
  return null;
}

/**
 * 读取字符串数组字段。
 *
 * @param raw 对象
 * @param keys 候选键
 * @returns 字符串数组
 */
export function readStringArray(raw: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    }
  }
  return [];
}

/**
 * 读取 number 字段。
 *
 * @param raw 对象
 * @param keys 候选键
 * @returns 值或 null
 */
export function readNumber(raw: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) {
      return raw[key] as number;
    }
  }
  return null;
}

/**
 * 读取时间字段；保留 OpenClaw 原始 number/string 形态。
 *
 * @param raw 对象
 * @param keys 候选键
 * @returns 时间值或 null
 */
export function readTimeLike(
  raw: Record<string, unknown>,
  keys: readonly string[],
): string | number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/**
 * 读取嵌套对象。
 *
 * @param raw 对象
 * @param keys 候选键
 * @returns 子对象或 null
 */
export function readRecord(raw: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * 读取对象数组。
 *
 * @param raw 对象
 * @param keys 候选键
 * @returns 对象数组
 */
export function readRecordArray(raw: Record<string, unknown>, keys: readonly string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const value = raw[key];
    if (!Array.isArray(value)) {
      continue;
    }
    return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }
  return [];
}

function textFromUnknown(value: unknown, depth: number): string | null {
  if (depth > 4 || value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const text = value
      .map((item) => textFromUnknown(item, depth + 1))
      .filter((item): item is string => Boolean(item))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text || null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["text", "content", "message", "summary", "output", "value", "parts"] as const) {
    const text = textFromUnknown(record[key], depth + 1);
    if (text) {
      return text;
    }
  }
  return null;
}
