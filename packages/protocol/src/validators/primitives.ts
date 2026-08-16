/**
 * 校验原语：类型、枚举、日期、非空字符串。
 *
 * 职责：为各域 validator 提供可组合的小型检查，控制分支复杂度。
 * 不拥有：业务域规则、schema 文件 I/O。
 * 纯函数：无副作用。
 */

import { validationFailed } from "../errors/protocol-error.js";
import type { ValidateResult } from "./result.js";

const DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 要求值为普通对象（非 null、非数组）。
 *
 * @param value 待检值
 * @param label 字段标签
 * @returns 收窄为 Record 或失败
 */
export function expectObject(value: unknown, label: string): ValidateResult<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: validationFailed(`${label} 必须是对象`) };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/**
 * 要求非空字符串。
 *
 * @param value 待检值
 * @param label 字段标签
 * @returns 字符串或失败
 */
export function expectNonEmptyString(value: unknown, label: string): ValidateResult<string> {
  if (typeof value !== "string" || value.length < 1) {
    return { ok: false, error: validationFailed(`${label} 必须是非空字符串`) };
  }
  return { ok: true, value };
}

/**
 * 要求 ISO-8601 date-time 字符串。
 *
 * @param value 待检值
 * @param label 字段标签
 * @returns 字符串或失败
 */
export function expectDateTime(value: unknown, label: string): ValidateResult<string> {
  const asString = expectNonEmptyString(value, label);
  if (!asString.ok) {
    return asString;
  }
  if (!DATE_TIME_RE.test(asString.value)) {
    return { ok: false, error: validationFailed(`${label} 必须是 ISO-8601 date-time`) };
  }
  return asString;
}

/**
 * 要求值属于给定枚举。
 *
 * @param value 待检值
 * @param label 字段标签
 * @param allowed 允许集合
 * @returns 收窄后的枚举值或失败
 */
export function expectEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): ValidateResult<T> {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return {
      ok: false,
      error: validationFailed(`${label} 不在允许枚举内`, { allowed: [...allowed] }),
    };
  }
  return { ok: true, value: value as T };
}

/**
 * 要求值为字符串数组。
 *
 * @param value 待检值
 * @param label 字段标签
 * @param minItems 最少元素数
 * @returns 字符串数组或失败
 */
export function expectStringArray(
  value: unknown,
  label: string,
  minItems = 0,
): ValidateResult<string[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: validationFailed(`${label} 必须是数组`) };
  }
  if (value.length < minItems) {
    return { ok: false, error: validationFailed(`${label} 长度不足 ${minItems}`) };
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = expectNonEmptyString(value[index], `${label}[${index}]`);
    if (!item.ok) {
      return item;
    }
  }
  return { ok: true, value: value as string[] };
}

/**
 * 读取可选字段：缺省返回 undefined；出现则交给 checker。
 *
 * @param obj 对象
 * @param key 字段名
 * @param checker 存在时的校验
 * @returns 校验结果；缺省时 ok 且 value 为 undefined
 */
export function optionalField<T>(
  obj: Record<string, unknown>,
  key: string,
  checker: (value: unknown) => ValidateResult<T>,
): ValidateResult<T | undefined> {
  if (!(key in obj)) {
    return { ok: true, value: undefined };
  }
  return checker(obj[key]);
}

/**
 * 字符串或 null。
 *
 * @param value 待检值
 * @param label 字段标签
 * @returns string | null 或失败
 */
export function expectStringOrNull(value: unknown, label: string): ValidateResult<string | null> {
  if (value === null) {
    return { ok: true, value: null };
  }
  return expectNonEmptyString(value, label);
}

/**
 * 断言对象无未声明额外字段。
 *
 * @param obj 对象
 * @param allowed 允许键
 * @param label 对象标签
 * @returns 空成功或失败
 */
export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): ValidateResult<undefined> {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(obj).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: validationFailed(`${label} 含未知字段`, { unknown }),
    };
  }
  return { ok: true, value: undefined };
}
