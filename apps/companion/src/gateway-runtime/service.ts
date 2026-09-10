/**
 * 自托管 gateway 运行时服务：写配置、启动进程、提供 adapter 与探针入口。
 */
import { prepareGatewayLaunch } from "./lifecycle/launch.js";
import { prepareRuntimeProvider } from "./lifecycle/provider/bootstrap.js";


import {
createGatewayRuntimeClient,
OpenClawAdapter
} from "@lanxin-claw/openclaw-adapter";
import fs from "node:fs";
import path from "node:path";
import {
GatewayRuntimeManager
} from "./manager.js";
import {
summarizeOpenClawToolCapabilitiesFromText,
type OpenClawToolCapabilitySummary,
} from "./openclaw-capability.js";
import {
OPENCLAW_BRAVE_KEY_ENV
} from "./openclaw-config.js";
import {
DEFAULT_GATEWAY_RESTART_DELAY_MS,
MAX_GATEWAY_RESTART_ATTEMPTS,
nextGatewayRestartDelayMs,
shouldRetryGatewayRestart,
} from "./policy/restart-policy.js";
import { sameGatewayRuntimeInput } from "./same-runtime-input.js";

/**
 * 自托管 gateway 运行时服务。
 */
export class GatewayRuntimeService {
  private readonly options: GatewayRuntimeServiceOptions;
  private manager: GatewayRuntimeManager | null = null;
  private handle: GatewayRuntimeHandle | null = null;
  private token = "";
  private lastInput: StartGatewayRuntimeInput | null = null;
  private desiredRunning = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private degraded = false;
  private lastRestartError: { code: string; message: string } | null = null;
  /** 进行中的 ensureStarted，避免并发双拉起 */
  private startInFlight: Promise<GatewayRuntimeHandle> | null = null;
  private startAbort: AbortController | null = null;

  /**
   * @param options 选项
   */
  constructor(options: GatewayRuntimeServiceOptions) {
    this.options = options;
  }

  /**
   * 当前是否已启动。
   *
   * @returns 是否运行
   */
  isRunning(): boolean {
    return this.handle !== null && this.manager?.isRunning() === true;
  }

  /**
   * 连续重启失败后停止拉起。
   *
   * @returns 是否 degraded
   */
  isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * 最近一次自动重启失败原因。
   *
   * @returns 错误；无则为 null
   */
  getLastRestartError(): { code: string; message: string } | null {
    return this.lastRestartError;
  }

  /**
   * 读取当前 stateDir 下 openclaw.json 的工具能力摘要（无 key 明文）。
   *
   * @returns 能力摘要
   */
  getOpenClawToolCapabilities(): OpenClawToolCapabilitySummary {
    const configPath = path.join(this.options.stateDir, "openclaw.json");
    let text = "";
    try {
      text = fs.readFileSync(configPath, "utf8");
    } catch {
      text = "";
    }
    const hasBraveApiKey = Boolean(
      this.lastInput?.webSearchApiKey?.trim() ||
        process.env[OPENCLAW_BRAVE_KEY_ENV]?.trim(),
    );
    return summarizeOpenClawToolCapabilitiesFromText(text, { hasBraveApiKey });
  }

  /**
   * 当前句柄（未启动为 null）。
   *
   * @returns 句柄
   */
  getHandle(): GatewayRuntimeHandle | null {
    return this.handle;
  }

  /**
   * 确保 gateway 已启动（幂等）；配置变化时重写 config 并重启。
   *
   * @param input 启动入参
   * @returns 运行句柄
   */
  async ensureStarted(input: StartGatewayRuntimeInput): Promise<GatewayRuntimeHandle> {
    this.desiredRunning = true;
    if (this.startInFlight) {
      return this.startInFlight;
    }
    if (this.handle && this.manager?.isRunning()) {
      if (sameGatewayRuntimeInput(this.lastInput, input)) {
        this.lastInput = input;
        return this.handle;
      }
      this.options.logger?.info({}, "OpenClaw 配置变更，重启 gateway");
      await this.stopRunningInstance();
    }
    this.lastInput = input;
    this.startAbort = new AbortController();
    this.startInFlight = this.startFresh(input, this.startAbort.signal).finally(() => {
      this.startInFlight = null;
      this.startAbort = null;
    });
    return this.startInFlight;
  }

  /**
   * 仅停当前实例，不清 desiredRunning（供配置热更新重启）。
   *
   * @returns 完成
   */
  private async stopRunningInstance(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
    this.handle = null;
  }

  /**
   * 写配置并启动新 gateway 子进程。
   *
   * @param input 启动入参
   * @returns 运行句柄
   */
  private async startFresh(input: StartGatewayRuntimeInput, signal: AbortSignal): Promise<GatewayRuntimeHandle> {
    if (this.handle && this.manager?.isRunning()) {
      return this.handle;
    }
    await prepareRuntimeProvider(input, this.options, signal);
    signal.throwIfAborted();
    const prepared = await prepareGatewayLaunch(input, this.options);
    signal.throwIfAborted();
    this.token = prepared.token;
    const managerOptions = prepared.managerOptions;
    managerOptions.onExit = (code, signal) => this.handleExit(code, signal);
    const manager = new GatewayRuntimeManager(managerOptions);
    this.manager = manager;
    const abort = (): void => { void manager.stop(); };
    signal.addEventListener("abort", abort, { once: true });
    let started: Awaited<ReturnType<GatewayRuntimeManager["start"]>>;
    try {
      started = await manager.start();
      signal.throwIfAborted();
    } catch (err) {
      await manager.stop().catch(() => undefined);
      this.manager = null;
      this.handle = null;
      if (this.consecutiveFailures === 0) {
        this.desiredRunning = false;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.lastRestartError = { code: "gateway_restart_failed", message };
        this.scheduleRestart(null, null);
      }
      throw err;
    } finally {
      signal.removeEventListener("abort", abort);
    }
    this.manager = manager;

    const runtime = createGatewayRuntimeClient({
      gatewayUrl: started.url,
      agentId: "main",
      defaultScopes: ["workspace.read"],
      authProvider: () => this.token,
      allowAdminAbort: true,
    });
    const adapter = new OpenClawAdapter({
      runtime,
      ...(this.options.adapterJobStore ? { store: this.options.adapterJobStore } : {}),
    });
    this.handle = {
      url: started.url,
      token: this.token,
      adapter,
      stop: () => this.stop(),
    };
    this.consecutiveFailures = 0;
    this.degraded = false;
    this.lastRestartError = null;
    this.options.logger?.info({ port: started.port }, "自托管 gateway 就绪");
    return this.handle;
  }

  /**
   * 停止 gateway。
   *
   * @returns 完成
   */
  async stop(): Promise<void> {
    this.desiredRunning = false;
    this.startAbort?.abort();
    await this.startInFlight?.catch(() => undefined);
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
    this.handle = null;
  }

  /**
   * 子进程退出回调：需要继续运行时自动重启。
   *
   * @param code 退出码
   * @param signal 信号
   */
  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const hadReadyHandle = this.handle !== null;
    this.manager = null;
    this.handle = null;
    if (!hadReadyHandle || !this.desiredRunning || !this.lastInput) {
      return;
    }
    this.scheduleRestart(code, signal);
  }

  /**
   * 按指数退避安排下一次拉起；超限则 degraded。
   *
   * @param code 退出码
   * @param signal 信号
   */
  private scheduleRestart(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.restartTimer) {
      return;
    }
    this.consecutiveFailures += 1;
    const maxAttempts = this.options.maxRestartAttempts ?? MAX_GATEWAY_RESTART_ATTEMPTS;
    if (!shouldRetryGatewayRestart(this.consecutiveFailures, maxAttempts)) {
      this.degraded = true;
      this.desiredRunning = false;
      this.lastRestartError = {
        code: "gateway_restart_exhausted",
        message: `自托管 gateway 连续退出 ${this.consecutiveFailures} 次，已停止自动重启`,
      };
      this.options.logger?.error(
        { code, signal, consecutiveFailures: this.consecutiveFailures },
        "自托管 gateway 进入 degraded，停止自动重启",
      );
      return;
    }
    const baseMs = this.options.restartDelayMs ?? DEFAULT_GATEWAY_RESTART_DELAY_MS;
    const delayMs = nextGatewayRestartDelayMs(this.consecutiveFailures, baseMs);
    this.options.logger?.warn(
      { code, signal, consecutiveFailures: this.consecutiveFailures, delayMs },
      "自托管 gateway 退出，按指数退避自动重启",
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.desiredRunning || !this.lastInput) {
        return;
      }
      void this.ensureStarted(this.lastInput).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.lastRestartError = { code: "gateway_restart_failed", message };
        this.options.logger?.error({ message, consecutiveFailures: this.consecutiveFailures }, "gateway 自动重启失败");
      });
    }, delayMs);
    this.restartTimer.unref?.();
  }
}

import type { GatewayRuntimeHandle, GatewayRuntimeServiceOptions, StartGatewayRuntimeInput } from "./lifecycle/types.js";
export type { GatewayRuntimeHandle, GatewayRuntimeServiceOptions, StartGatewayRuntimeInput } from "./lifecycle/types.js";
