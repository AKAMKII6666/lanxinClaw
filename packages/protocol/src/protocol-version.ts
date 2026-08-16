/**
 * 协议版本常量。
 *
 * 职责：提供与 schemas `protocolVersion` / `schemaVersion` 对齐的单一版本常量。
 * 不拥有：兼容协商、多版本并存路由。
 * 纯函数：仅导出常量。
 */

/** 当前 wire / UI schema 版本；须与顶层 schemas 的 const 对齐 */
export const PROTOCOL_VERSION = "0.1" as const;

/** 协议版本字面量类型 */
export type ProtocolVersion = typeof PROTOCOL_VERSION;
