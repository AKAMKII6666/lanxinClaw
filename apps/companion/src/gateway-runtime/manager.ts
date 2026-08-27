/**
 * 自托管 OpenClaw Gateway 进程管理器。
 *
 * 职责：以隔离环境变量 spawn OpenClaw gateway 子进程，探测就绪端口，
 * 转发 stdout/stderr 到日志，并支持优雅停止与退出回调。
 * 不拥有：openclaw.json 内容生成（由 onboarding 写入 stateDir）、权限裁决、协议消息。
 * 副作用：启动/停止子进程；监听端口；写日志。
 */

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import type { Logger } from "pino";

/** 默认启动超时毫秒（覆盖 Windows 冷启动约 60s，留余量） */
export const DEFAULT_STARTUP_TIMEOUT_MS = 90_000;

/**
 * OpenClaw gateway 就绪 stdout 标记。
 * 真实 OpenClaw 打 `[gateway] ready`；测试假网关打 `ready:<stateDir>`。
 */
export const GATEWAY_READY_STDOUT_PATTERN = /\[gateway\]\s*ready\b|^ready:/i;

/** 管理器选项 */
export interface GatewayRuntimeManagerOptions {
  /** node 可执行文件；默认 process.execPath（捆绑 Node 时显式传入） */
  nodeBin?: string;
  /** openclaw 入口脚本绝对路径（dist/index.js） */
  openclawEntry: string;
  /** 隔离 state 目录（OPENCLAW_STATE_DIR）；由调用方保证已建 */
  stateDir: string;
  /** 本地 gateway token（不入日志） */
  token: string;
  /** 监听端口；缺省自动选空闲端口 */
  port?: number;
  /** 监听 host；默认 127.0.0.1 */
  host?: string;
  /** 附加环境变量（如 OPENCLAW_SKIP_CHANNELS=1） */
  env?: Record<string, string>;
  /** stdout 行回调（转发 pino runtime 模块） */
  onStdout?: (line: string) => void;
  /** stderr 行回调 */
  onStderr?: (line: string) => void;
  /** 退出回调（含崩溃重启策略由调用方决定） */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** 启动超时毫秒；默认 90000 */
  startupTimeoutMs?: number;
  /** 日志；可选 */
  logger?: Logger;
}

/** 启动结果 */
export interface GatewayRuntimeHandle {
  /** WebSocket URL */
  url: string;
  /** 实际端口 */
  port: number;
  /** 停止子进程 */
  stop: () => Promise<void>;
}

/**
 * 自托管 gateway 管理器。
 */
export class GatewayRuntimeManager {
  private readonly options: GatewayRuntimeManagerOptions;
  private child: ChildProcess | null = null;
  private boundPort: number | null = null;
  private stopped = false;

  /**
   * @param options 选项
   */
  constructor(options: GatewayRuntimeManagerOptions) {
    this.options = options;
  }

  /**
   * 启动 gateway 子进程并等待端口就绪。
   *
   * @returns 启动结果
   */
  async start(): Promise<GatewayRuntimeHandle> {
    if (this.child) {
      throw new Error("gateway_already_started");
    }
    const port = this.options.port ?? (await findFreePort());
    const nodeBin = this.options.nodeBin ?? process.execPath;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCLAW_STATE_DIR: this.options.stateDir,
      OPENCLAW_CONFIG_PATH: path.join(this.options.stateDir, "openclaw.json"),
      OPENCLAW_OAUTH_DIR: path.join(this.options.stateDir, "credentials"),
      OPENCLAW_GATEWAY_PORT: String(port),
      ...(this.options.env ?? {}),
    };
    this.options.logger?.info({ port }, "启动自托管 OpenClaw gateway");
    const child = spawn(nodeBin, [this.options.openclawEntry, "gateway", "run"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stopped = false;
    let stdoutReady = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        if (GATEWAY_READY_STDOUT_PATTERN.test(line)) {
          stdoutReady = true;
        }
        this.options.onStdout?.(line);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) {
          this.options.onStderr?.(line);
        }
      }
    });
    child.once("exit", (code, signal) => {
      this.child = null;
      this.options.logger?.warn({ code, signal }, "自托管 gateway 子进程退出");
      this.options.onExit?.(code, signal);
    });
    child.once("error", (err) => {
      this.options.logger?.error({ message: err.message }, "自托管 gateway 子进程错误");
    });

    try {
      await waitForGatewayReady(
        port,
        this.options.host ?? "127.0.0.1",
        this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
        () => this.child !== null,
        () => stdoutReady,
      );
    } catch (err) {
      await this.stop();
      throw err;
    }
    if (!this.child) {
      await this.stop();
      throw new Error("gateway_exited_before_ready");
    }
    this.boundPort = port;
    return {
      url: `ws://${this.options.host ?? "127.0.0.1"}:${port}`,
      port,
      stop: () => this.stop(),
    };
  }

  /**
   * 是否在运行。
   *
   * @returns 是否运行
   */
  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /**
   * 已绑定端口。
   *
   * @returns 端口或 null
   */
  getPort(): number | null {
    return this.boundPort;
  }

  /**
   * 优雅停止子进程；超时后强杀。
   *
   * @returns 完成
   */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || this.stopped) {
      return;
    }
    this.stopped = true;
    this.options.logger?.info("停止自托管 OpenClaw gateway");
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = null;
  }
}

/**
 * 找一个空闲 TCP 端口。
 *
 * @returns 端口
 */
export async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("find_free_port_failed")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * 等待 gateway 真正就绪：stdout 出现 ready 标记，且端口可连。
 * 仅 TCP 可连不够——OpenClaw 可能短暂占端口后再进入加载，过早探针会 ECONNREFUSED。
 *
 * @param port 端口
 * @param host host
 * @param timeoutMs 超时
 * @param isProcessAlive 子进程是否仍在
 * @param isStdoutReady stdout 是否已见 ready
 * @returns 完成
 */
async function waitForGatewayReady(
  port: number,
  host: string,
  timeoutMs: number,
  isProcessAlive: () => boolean,
  isStdoutReady: () => boolean,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isProcessAlive()) {
      throw new Error("gateway_exited_before_ready");
    }
    if (isStdoutReady() && (await probePort(port, host))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`gateway_startup_timeout:${host}:${port}`);
}

/**
 * 探测端口是否可连接。
 *
 * @param port 端口
 * @param host host
 * @returns 是否可连
 */
function probePort(port: number, host: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(500);
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
