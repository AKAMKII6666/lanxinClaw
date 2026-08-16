/**
 * 校验结果类型。
 *
 * 职责：统一 validators 的成功/失败返回形状。
 * 不拥有：错误上报、重试调度。
 * 纯函数：仅类型。
 */

import type { ProtocolError } from "../errors/protocol-error.js";

/** 校验成功并携带收窄后的值 */
export interface ValidateOk<T> {
  /** 成功标记 */
  ok: true;
  /** 通过校验的值 */
  value: T;
}

/** 校验失败 */
export interface ValidateErr {
  /** 失败标记 */
  ok: false;
  /** 协议错误对象 */
  error: ProtocolError;
}

/** 校验结果联合 */
export type ValidateResult<T> = ValidateOk<T> | ValidateErr;
