/** 分离职责的协议校验；纯函数，无 I/O 或状态提交。 */
import {
type JobPayload
} from "../../../../messages/payloads/core.js";
import {
expectDateTime,
expectStringOrNull,
optionalField
} from "../../../primitives.js";
import type { ValidateErr } from "../../../result.js";


/**
 * 读取可选 string|null 字段并写入目标对象。
 *
 * @param obj 源对象
 * @param key 字段名
 * @param target 目标载荷
 * @returns 失败时返回错误结果；成功返回 null
 */
export function assignOptionalStringOrNull<T extends object>(
  obj: Record<string, unknown>,
  key: keyof T & string,
  target: T,
): ValidateErr | null {
  const checked = optionalField(obj, key, (v) => expectStringOrNull(v, key));
  if (!checked.ok) {
    return checked;
  }
  if (checked.value !== undefined) {
    (target as Record<string, unknown>)[key] = checked.value;
  }
  return null;
}

/**
 * 读取可选 date-time|null 字段并写入 JobPayload。
 *
 * @param obj 源对象
 * @param key 字段名
 * @param target 目标载荷
 * @returns 失败时返回错误；成功返回 null
 */
export function assignOptionalDateTimeOrNull(
  obj: Record<string, unknown>,
  key: "statusObservedAt",
  target: JobPayload,
): ValidateErr | null {
  if (!(key in obj)) {
    return null;
  }
  if (obj[key] === null) {
    target[key] = null;
    return null;
  }
  const checked = expectDateTime(obj[key], key);
  if (!checked.ok) {
    return checked;
  }
  target[key] = checked.value;
  return null;
}
