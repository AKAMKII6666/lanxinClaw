/**
 * onboarding 配置类型。
 */

/** 模型 provider 标识 */
export type OnboardingProvider = "qwen" | "openai" | "anthropic" | "openai-compatible" | "local";

/** 用户配置（明文只存在于内存，落盘前加密） */
export interface OnboardingConfig {
  /** provider 标识 */
  provider: OnboardingProvider;
  /** 模型 API key；local provider 可为空 */
  apiKey: string;
  /** 兼容端点；qwen/openai-compatible/local 必填（qwen 由 preset 注入） */
  endpoint: string | null;
  /** 模型引用（provider/model，如 openai/gpt-5.5） */
  modelRef: string;
  /** 用户同意启用 OpenClaw 网页搜索能力；默认 false */
  enableWebSearch?: boolean;
  /** 用户同意启用 OpenClaw browser 能力；默认 false */
  enableBrowser?: boolean;
  /** Brave 等 web search API key；仅内存/加密存储，不入 openclaw.json */
  webSearchApiKey?: string;
}

/** 探针结果 */
export type ProbeResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/** onboarding 状态 */
export type OnboardingStatus = "unconfigured" | "configuring" | "ready" | "failed";

/** 提交/冷启动过程中的阶段（推送给 renderer 展示） */
export type OnboardingPhase = "verifying_key" | "starting_runtime";
