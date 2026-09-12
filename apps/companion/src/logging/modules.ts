/**
 * 日志模块常量。
 *
 * 职责：定义按模块落盘的文件划分，供 LLM Agent 按问题域精确定位日志。
 * 不拥有：pino 实例、文件 I/O、redact 策略。
 * 纯常量：无副作用。
 */

/** 模块 → 落盘文件名（<module>.log），error 级另聚合到 error.log */
export const LOG_MODULES = [
  "system",
  "protocol",
  "discovery",
  "adapter",
  "supervision",
  "audit",
  "bridge",
  "shell",
  "transport",
  "ui",
  "runtime",
] as const;

/** 日志模块名 */
export type LogModule = (typeof LOG_MODULES)[number];

/** error 级聚合文件名 */
export const ERROR_LOG_FILE = "error.log";

/**
 * 判断是否为已登记模块。
 *
 * @param value 候选值
 * @returns 是否合法模块
 */
export function isLogModule(value: unknown): value is LogModule {
  return typeof value === "string" && (LOG_MODULES as readonly string[]).includes(value);
}

/**
 * 返回模块落盘文件名。
 *
 * @param module 模块
 * @returns 文件名
 */
export function logFileForModule(module: LogModule): string {
  return `${module}.log`;
}
