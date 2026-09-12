/**
 * onboarding 服务：配置门状态机 + 两级探针。
 */

import type { Logger } from "pino";
import type {
  OnboardingConfig,
  OnboardingPhase,
  OnboardingStatus,
  ProbeResult,
} from "./types.js";
import type { OnboardingStore } from "./store/store.js";
import { probeProviderKey } from "./probe/provider-probe.js";

/** 运行时就绪探针（由装配层注入：启动自托管 gateway 后跑最小 run） */
export type RuntimeReadyProbe = () => Promise<ProbeResult>;

/** 提交/冷启动可选回调 */
export interface OnboardingRunOptions {
  /** 阶段推进回调（供 IPC 推送 UI） */
  onPhase?: (phase: OnboardingPhase) => void;
}

/** 服务选项 */
export interface OnboardingServiceOptions {
  /** 配置存储 */
  store: OnboardingStore;
  /** 运行时就绪探针 */
  runtimeReadyProbe: RuntimeReadyProbe;
  /** 日志；可选 */
  logger?: Logger;
}

/**
 * onboarding 服务。
 */
export class OnboardingService {
  private readonly store: OnboardingStore;
  private readonly runtimeReadyProbe: RuntimeReadyProbe;
  private readonly logger: Logger | null;
  private status: OnboardingStatus = "unconfigured";
  private lastError: { code: string; message: string } | null = null;

  /**
   * @param options 选项
   */
  constructor(options: OnboardingServiceOptions) {
    this.store = options.store;
    this.runtimeReadyProbe = options.runtimeReadyProbe;
    this.logger = options.logger ?? null;
    this.status = this.store.load() ? "ready" : "unconfigured";
  }

  /**
   * 当前状态。
   *
   * @returns 状态
   */
  getStatus(): OnboardingStatus {
    return this.status;
  }

  /**
   * 最近失败原因（供 UI 展示）。
   *
   * @returns 错误或 null
   */
  getLastError(): { code: string; message: string } | null {
    return this.lastError;
  }

  /**
   * 提交配置并执行两级探针。
   * 成功 → ready；失败 → failed 并保留原因，主界面不可达。
   *
   * @param config 用户配置（明文仅内存）
   * @param options 可选阶段回调
   * @returns 探针结果
   */
  async submitConfig(config: OnboardingConfig, options?: OnboardingRunOptions): Promise<ProbeResult> {
    this.status = "configuring";
    this.lastError = null;
    options?.onPhase?.("verifying_key");
    const keyProbe = await probeProviderKey(config);
    if (!keyProbe.ok) {
      this.status = "failed";
      this.lastError = { code: keyProbe.code, message: keyProbe.message };
      this.logger?.warn({ code: keyProbe.code }, "provider key 探针失败");
      return keyProbe;
    }
    this.store.save(config);
    options?.onPhase?.("starting_runtime");
    const runtimeProbe = await this.runRuntimeReadyProbe();
    if (!runtimeProbe.ok) {
      this.status = "failed";
      this.lastError = { code: runtimeProbe.code, message: runtimeProbe.message };
      this.logger?.warn({ code: runtimeProbe.code }, "运行时就绪探针失败");
      return runtimeProbe;
    }
    this.status = "ready";
    this.logger?.info({ provider: config.provider }, "onboarding 完成");
    return { ok: true };
  }

  /**
   * 已有配置时拉起运行时并探针（冷启动门闩）。
   * 失败不清除已存配置；lastError 供 UI 重试展示。
   *
   * @param options 可选阶段回调
   * @returns 探针结果
   */
  async bootstrapRuntime(options?: OnboardingRunOptions): Promise<ProbeResult> {
    const stored = this.store.load();
    if (!stored) {
      this.status = "unconfigured";
      this.lastError = { code: "onboarding_config_missing", message: "缺少模型配置" };
      return { ok: false, code: "onboarding_config_missing", message: "缺少模型配置" };
    }
    this.lastError = null;
    options?.onPhase?.("starting_runtime");
    const runtimeProbe = await this.runRuntimeReadyProbe();
    if (!runtimeProbe.ok) {
      this.lastError = { code: runtimeProbe.code, message: runtimeProbe.message };
      this.logger?.warn({ code: runtimeProbe.code }, "冷启动运行时探针失败");
      return runtimeProbe;
    }
    this.status = "ready";
    this.logger?.info({ provider: stored.provider }, "冷启动运行时就绪");
    return { ok: true };
  }

  /**
   * 清除配置并回到未配置状态。
   */
  clear(): void {
    this.store.clear();
    this.status = "unconfigured";
    this.lastError = null;
    this.logger?.info("onboarding 配置已清除");
  }

  private async runRuntimeReadyProbe(): Promise<ProbeResult> {
    try {
      return await this.runtimeReadyProbe();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const safeMessage = redactSecretLikeText(message);
      this.logger?.warn({ message: safeMessage }, "运行时就绪探针异常");
      return {
        ok: false,
        code: "runtime_probe_failed",
        message: safeMessage || "OpenClaw 运行时启动失败",
      };
    }
  }
}

function redactSecretLikeText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/([?&](?:token|api[_-]?key)=)[^&\s]+/gi, "$1***");
}
