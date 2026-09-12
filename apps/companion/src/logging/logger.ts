/**
 * pino 日志工厂：按模块落盘、error 聚合、redact、轮转。
 *
 * 职责：创建按模块分文件的 pino logger，统一脱敏与轮转策略。
 * 不拥有：协议/业务日志内容语义、凭据明文、日志查询脚本。
 * 副作用：打开日志文件流并写入；close 时关闭全部流。
 */

import path from "node:path";
import type { Writable } from "node:stream";
import { multistream, pino, type Logger, type StreamEntry } from "pino";
import pinoRoll from "pino-roll";
import {
  ERROR_LOG_FILE,
  logFileForModule,
  LOG_MODULES,
  type LogModule,
} from "./modules.js";

/** 默认日志级别 */
export const DEFAULT_LOG_LEVEL = "info";
/** 默认单文件轮转大小 */
export const DEFAULT_ROTATE_SIZE = "10MB";
/** 默认保留轮转文件数 */
export const DEFAULT_ROTATE_LIMIT = 7;

/** 日志选项 */
export interface LoggingOptions {
  /** 日志目录（绝对路径） */
  dir: string;
  /** 日志级别；默认 info */
  level?: string;
  /** 单文件轮转大小；默认 10MB */
  rotateSize?: string;
  /** 保留轮转文件数；默认 7 */
  rotateLimit?: number;
}

/**
 * 解析日志目录：LANXIN_LOG_DIR > userData/logs > <cwd>/runtime/logs。
 *
 * @param env 环境变量（默认 process.env）
 * @param userDataDir Electron userData 目录；可空
 * @returns 绝对日志目录
 */
export function resolveLogDir(
  env: NodeJS.ProcessEnv = process.env,
  userDataDir?: string | null,
): string {
  const override = env.LANXIN_LOG_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (userDataDir) {
    return path.join(userDataDir, "logs");
  }
  return path.resolve(process.cwd(), "runtime", "logs");
}

/** 脱敏路径：凭据/令牌/配对秘密/challenge 一律不落盘 */
const REDACT_PATHS = [
  "pairingSecret",
  "*.pairingSecret",
  "**.pairingSecret",
  "authProof",
  "*.authProof",
  "**.authProof",
  "token",
  "*.token",
  "**.token",
  "apiKey",
  "*.apiKey",
  "**.apiKey",
  "api_key",
  "*.api_key",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "req.headers.authorization",
  "challenge",
  "*.challenge",
  "password",
  "*.password",
  "secret",
  "*.secret",
];

/**
 * 日志注册表：按模块持有独立 logger，共享 error 聚合流。
 */
export class LoggerRegistry {
  private readonly dir: string;
  private readonly options: LoggingOptions;
  private readonly loggers = new Map<LogModule, Logger>();
  private readonly moduleStreams = new Map<LogModule, Writable>();
  private errorStream: Writable | null = null;

  /**
   * @param options 日志选项（含目录）
   */
  constructor(options: LoggingOptions) {
    this.dir = options.dir;
    this.options = options;
  }

  /**
   * 初始化全部模块日志流（幂等）。
   *
   * @returns 完成
   */
  async init(): Promise<void> {
    if (this.moduleStreams.size > 0) {
      return;
    }
    const level = this.options.level ?? DEFAULT_LOG_LEVEL;
    const rotateSize = normalizeRotateSize(this.options.rotateSize ?? DEFAULT_ROTATE_SIZE);
    const rotateLimit = this.options.rotateLimit ?? DEFAULT_ROTATE_LIMIT;
    for (const module of LOG_MODULES) {
      const stream = await pinoRoll({
        file: path.join(this.dir, logFileForModule(module)),
        size: rotateSize,
        limit: { count: Math.max(1, rotateLimit - 1) },
        mkdir: true,
      });
      this.moduleStreams.set(module, stream);
    }
    this.errorStream = await pinoRoll({
      file: path.join(this.dir, ERROR_LOG_FILE),
      size: rotateSize,
      limit: { count: Math.max(1, rotateLimit - 1) },
      mkdir: true,
    });
  }

  /**
   * 取模块 logger（懒创建 logger，流已在 init 预建）。
   *
   * @param module 模块名
   * @returns pino logger
   */
  getLogger(module: LogModule): Logger {
    const existing = this.loggers.get(module);
    if (existing) {
      return existing;
    }
    const level = this.options.level ?? DEFAULT_LOG_LEVEL;
    const moduleStream = this.moduleStreams.get(module);
    if (!moduleStream) {
      throw new Error(`logger not initialized for module: ${module}`);
    }
    const streams: StreamEntry[] = [{ stream: moduleStream }];
    if (module !== "system") {
      if (!this.errorStream) {
        throw new Error("error stream not initialized");
      }
      streams.push({ level: "error", stream: this.errorStream });
    }
    const logger = pino(
      {
        level,
        redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
        base: { service: "lanxin-companion", module },
      },
      multistream(streams),
    );
    this.moduleStreams.set(module, moduleStream);
    this.loggers.set(module, logger);
    return logger;
  }

  /**
   * 日志目录（供诊断/脚本使用）。
   *
   * @returns 目录
   */
  getDir(): string {
    return this.dir;
  }

  /**
   * 关闭全部日志流。
   *
   * @returns 完成
   */
  async close(): Promise<void> {
    const streams: Writable[] = [...this.moduleStreams.values()];
    if (this.errorStream) {
      streams.push(this.errorStream);
    }
    await Promise.all(streams.map((stream) => flushAndEnd(stream)));
    this.loggers.clear();
    this.moduleStreams.clear();
    this.errorStream = null;
  }

}

/**
 * 规范化轮转大小写法（pino-roll 只认 k/m/g 小写）。
 *
 * @param size 如 "10MB"、"10m"、"1GB"
 * @returns pino-roll 可接受的大小
 */
function normalizeRotateSize(size: string): string {
  const match = /^(\d+(?:\.\d+)?)\s*(kb|k|mb|m|gb|g)$/i.exec(size.trim());
  if (!match) {
    return size.trim();
  }
  const unitRaw = match[2]?.toLowerCase() ?? "";
  const unit = unitRaw === "kb" ? "k" : unitRaw === "mb" ? "m" : unitRaw === "gb" ? "g" : unitRaw;
  return `${match[1] ?? ""}${unit}`;
}

/**
 * 等待 SonicBoom ready 后同步刷盘并结束流。
 *
 * @param stream 日志流
 * @returns 完成
 */
async function flushAndEnd(stream: Writable): Promise<void> {
  const boom = stream as Writable & { fd?: number; flushSync?: () => void };
  if (boom.fd === undefined || boom.fd < 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 2_000);
      timer.unref?.();
      stream.once("ready", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  boom.flushSync?.();
  stream.end();
}

/**
 * 异步创建日志注册表（打开全部模块流）。
 *
 * @param options 选项
 * @returns 注册表
 */
export async function createLoggerRegistry(options: LoggingOptions): Promise<LoggerRegistry> {
  const registry = new LoggerRegistry(options);
  await registry.init();
  return registry;
}
