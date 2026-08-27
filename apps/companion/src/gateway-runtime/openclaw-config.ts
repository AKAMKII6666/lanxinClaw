/**
 * 生成自托管 openclaw.json（openclaw@2026.7.1-2 最小配置）。
 *
 * 职责：按隔离 state 目录与模型配置生成 gateway 配置；apiKey 用 env ref，不入盘。
 * 不拥有：真实凭据明文、gateway 进程管理、权限裁决。
 * 纯函数：返回 JSON 字符串，无 I/O。
 */

/** 子进程注入的模型 key 环境变量名 */
export const OPENCLAW_MODEL_KEY_ENV = "LANXIN_OPENCLAW_API_KEY";

/** 生成配置入参 */
export interface GenerateOpenClawConfigInput {
  /** 本地 gateway token */
  token: string;
  /** 监听端口 */
  port: number;
  /** 模型引用（provider/model，如 openai/gpt-5.5） */
  modelRef: string;
  /** provider id（models.providers.<id>） */
  providerId: string;
  /** 是否配置 API key（env ref）；local 模型可关 */
  withApiKey: boolean;
  /** 模型服务端点；openai-compatible 与 local 场景使用 */
  baseUrl?: string | null;
  /** agent 工作区 */
  workspace: string;
  /** OpenClaw 自身日志文件（JSON lines） */
  logFile: string;
}

/**
 * 生成 openclaw.json 内容。
 *
 * @param input 入参
 * @returns JSON 字符串
 */
export function generateOpenClawConfig(input: GenerateOpenClawConfigInput): string {
  const providerConfig: Record<string, unknown> = {};
  if (input.withApiKey) {
    providerConfig.apiKey = {
      source: "env",
      provider: "default",
      id: OPENCLAW_MODEL_KEY_ENV,
    };
  }
  if (input.baseUrl?.trim()) {
    providerConfig.baseUrl = input.baseUrl.trim();
  }
  const config = {
    gateway: {
      mode: "local",
      bind: "loopback",
      port: input.port,
      auth: { mode: "token", token: input.token },
    },
    agents: {
      defaults: {
        model: input.modelRef,
        workspace: input.workspace,
      },
    },
    models: {
      providers: {
        [input.providerId]: providerConfig,
      },
    },
    logging: {
      level: "warn",
      file: input.logFile,
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * 按 provider 推断 provider id 与模型 key 是否必需。
 *
 * @param provider 模型服务标识
 * @param endpoint 端点
 * @returns 结果：providerId、needsKey、baseUrl
 */
export function providerMeta(
  provider: string,
  endpoint: string | null,
  modelRef?: string | null,
): { providerId: string; needsKey: boolean; baseUrl: string | null } {
  switch (provider) {
    case "qwen":
      return { providerId: "qwen", needsKey: true, baseUrl: endpoint };
    case "openai":
      return { providerId: "openai", needsKey: true, baseUrl: null };
    case "anthropic":
      return { providerId: "anthropic", needsKey: true, baseUrl: null };
    case "openai-compatible":
      return { providerId: providerIdFromModelRef(modelRef) ?? "custom", needsKey: true, baseUrl: endpoint };
    case "local":
      return { providerId: providerIdFromModelRef(modelRef) ?? "custom", needsKey: false, baseUrl: endpoint };
    default:
      return { providerId: providerIdFromModelRef(modelRef) ?? "custom", needsKey: true, baseUrl: endpoint };
  }
}

function providerIdFromModelRef(modelRef: string | null | undefined): string | null {
  const providerId = modelRef?.split("/", 1)[0]?.trim();
  if (!providerId || !/^[a-zA-Z0-9._-]+$/.test(providerId)) {
    return null;
  }
  return providerId;
}
