/** 协议测试日志记录端口，不记录真实凭据。 */
import type { Logger } from "pino";


export function createCaptureLogger(): {
  logger: Logger;
  entries: Array<{ level: string; meta: Record<string, unknown>; message: string }>;
} {
  const entries: Array<{ level: string; meta: Record<string, unknown>; message: string }> = [];
  const push = (level: string, meta: Record<string, unknown>, message: string): void => {
    entries.push({ level, meta, message });
  };
  return {
    entries,
    logger: {
      info: (meta: Record<string, unknown>, message: string) => push("info", meta, message),
      warn: (meta: Record<string, unknown>, message: string) => push("warn", meta, message),
      error: (meta: Record<string, unknown>, message: string) => push("error", meta, message),
    } as unknown as Logger,
  };
}
