/**
 * Adapter 包元信息。
 *
 * 职责：暴露契约版本与包名，供诊断探针使用。
 * 不拥有：job 执行、权限、配对。
 * 纯函数：无 I/O。
 */

/** adapter 自身契约版本；须与协议 protocolVersion 对齐。 */
export const ADAPTER_CONTRACT_VERSION = "0.2" as const;

/**
 * 返回 adapter 包标识。
 *
 * @returns 不含凭据或本机绝对路径的包名
 */
export function getOpenClawAdapterPackageName(): string {
  return "@lanxin-claw/openclaw-adapter";
}
