/**
 * 生成自托管 openclaw.json（openclaw@2026.7.1-2 最小配置）。
 *
 * 职责：按隔离 state 目录与模型配置生成 gateway 配置；apiKey 用 env ref，不入盘。
 * 不拥有：真实凭据明文、gateway 进程管理、权限裁决。
 * 纯函数：返回 JSON 字符串，无 I/O。
 */

/** 子进程注入的模型 key 环境变量名 */
export const OPENCLAW_MODEL_KEY_ENV = "LANXIN_OPENCLAW_API_KEY";

/** 子进程注入的 Brave web search key 环境变量名（不入 openclaw.json 明文；产品默认不启用 web_search） */
export const OPENCLAW_BRAVE_KEY_ENV = "BRAVE_API_KEY";

/** 可选网页工具写入选项（产品默认开 browser；web_search 仅显式开启） */
export interface OpenClawWebToolsConfigInput {
  /** 启用 tools.web.search（产品默认 false，不走此路径） */
  enableWebSearch: boolean;
  /** 启用 browser；产品安装档恒为 true */
  enableBrowser: boolean;
  /** web search provider；缺省 brave */
  webSearchProvider?: string;
  /** 是否声明 search apiKey 走 env ref（不写明文） */
  withWebSearchApiKey?: boolean;
  /** 托管浏览器走本地代理；默认 false */
  browserProxyEnabled?: boolean;
  /**
   * 本地代理 URL；开启时写入 browser.extraArgs --proxy-server、
   * browser.ssrfPolicy.dangerouslyAllowPrivateNetwork、
   * tools.web.fetch.ssrfPolicy（RFC2544/ULA）与 useTrustedEnvProxy；
   * 子进程 HTTP(S)_PROXY 由 GatewayRuntimeService 同源注入。
   */
  browserProxyUrl?: string | null;
}

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
  /**
   * 可选网页能力覆盖。
   * 未传时仍默认写入 browser（安装即可用）；web_search 仅在显式 enableWebSearch 时写入。
   */
  webTools?: OpenClawWebToolsConfigInput | null;
}

/**
 * 将网页工具与本地代理偏好写入 config.tools / config.browser。
 *
 * @param config 正在组装的 openclaw 配置
 * @param webTools 可选网页工具入参
 */
function applyWebToolsAndBrowserProxy(
  config: Record<string, unknown>,
  webTools: OpenClawWebToolsConfigInput | null | undefined,
): void {
  const enableBrowser = webTools ? webTools.enableBrowser !== false : true;
  const enableWebSearch = webTools?.enableWebSearch === true;
  const tools: Record<string, unknown> = {};
  const alsoAllow: string[] = [];
  const proxyUrl = webTools?.browserProxyUrl?.trim() ?? "";
  const browserProxyOn = webTools?.browserProxyEnabled === true && Boolean(proxyUrl);

  if (enableWebSearch) {
    tools.web = {
      search: {
        enabled: true,
        provider: webTools?.webSearchProvider?.trim() || "brave",
      },
    };
    alsoAllow.push("group:web");
  }

  if (enableBrowser) {
    alsoAllow.push("browser");
    const browser: Record<string, unknown> = {
      enabled: true,
      defaultProfile: "openclaw",
      headless: false,
    };
    if (browserProxyOn) {
      browser.extraArgs = [`--proxy-server=${proxyUrl}`];
      browser.ssrfPolicy = { dangerouslyAllowPrivateNetwork: true };
    }
    config.browser = browser;
  }

  if (browserProxyOn) {
    // web.fetch.ssrfPolicy 为 .strict()，仅允许 RFC2544/ULA；写 dangerouslyAllowPrivateNetwork 会拒启动。
    const web = (tools.web as Record<string, unknown> | undefined) ?? {};
    web.fetch = {
      useTrustedEnvProxy: true,
      ssrfPolicy: {
        allowRfc2544BenchmarkRange: true,
        allowIpv6UniqueLocalRange: true,
      },
    };
    tools.web = web;
  }

  if (alsoAllow.length > 0 || tools.web) {
    if (alsoAllow.length > 0) {
      tools.alsoAllow = alsoAllow;
    }
    config.tools = tools;
  }
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
  const config: Record<string, unknown> = {
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
  applyWebToolsAndBrowserProxy(config, input.webTools);
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
