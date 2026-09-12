/**
 * pino-roll 最小类型声明（上游未提供 .d.ts）。
 */
declare module "pino-roll" {
  import type { Writable } from "node:stream";

  /** pino-roll 保留策略 */
  export interface PinoRollLimit {
    /** 额外保留的轮转文件数（不含当前文件） */
    count: number;
  }

  /** pino-roll 选项 */
  export interface PinoRollOptions {
    /** 日志文件绝对路径 */
    file: string;
    /** 轮转大小阈值，如 "10MB" 或字节数 */
    size?: string | number;
    /** 时间频率（与 size 二选一） */
    frequency?: string | number;
    /** 保留策略 */
    limit?: PinoRollLimit;
    /** 轮转文件名扩展名 */
    extension?: string;
    /** 轮转文件名日期格式 */
    dateFormat?: string;
    /** 自动创建目录 */
    mkdir?: boolean;
    /** 其它透传选项 */
    [key: string]: unknown;
  }

  /** 创建轮转 writable stream（async 工厂） */
  export default function pinoRoll(options: PinoRollOptions): Promise<Writable>;
}
