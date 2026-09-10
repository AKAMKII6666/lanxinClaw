/**
 * 从 openclaw.json 解析 web/browser 能力摘要（配置级探针，不做实网爬取）。
 *
 * 职责：只读解析能力事实，供诊断、snapshot 与 job.create 预检。
 * 不拥有：Gateway 进程、权限裁决、凭据明文。
 * 纯函数：入参为已解析对象或 JSON 文本，无 I/O。
 */

import type { PermissionId } from "@lanxin-claw/protocol";
import { permissionInferenceText } from "@lanxin-claw/protocol";

/** 单项能力 */
export interface OpenClawToolCapabilityItem {
  /** 配置是否显式或默认可启用 */
  enabled: boolean;
  /** 是否具备可用线索（provider / key 引用 / alsoAllow） */
  ready: boolean;
  /** 只读说明；不得含 API key 明文 */
  detail: string;
}

/** OpenClaw 工具能力矩阵（脱敏） */
export interface OpenClawToolCapabilitySummary {
  /** web_search */
  webSearch: OpenClawToolCapabilityItem;
  /** web_fetch（随 tools.web 或默认） */
  webFetch: OpenClawToolCapabilityItem;
  /** browser 自动化 */
  browser: OpenClawToolCapabilityItem;
}

/**
 * 解析 openclaw 配置对象为能力摘要。
 *
 * @param config 已解析的 openclaw.json 对象；可空
 * @param envHints 可选环境线索（如是否存在 BRAVE_API_KEY）；不得传入 key 明文
 * @returns 能力摘要
 */
export function summarizeOpenClawToolCapabilities(
  config: unknown,
  envHints?: { hasBraveApiKey?: boolean } | null,
): OpenClawToolCapabilitySummary {
  const root = isRecord(config) ? config : {};
  const tools = isRecord(root.tools) ? root.tools : {};
  const web = isRecord(tools.web) ? tools.web : {};
  const search = isRecord(web.search) ? web.search : {};
  const fetchCfg = isRecord(web.fetch) ? web.fetch : {};
  const browser = isRecord(root.browser) ? root.browser : {};
  const alsoAllow = Array.isArray(tools.alsoAllow)
    ? tools.alsoAllow.map((item) => String(item))
    : [];
  const allow = Array.isArray(tools.allow) ? tools.allow.map((item) => String(item)) : [];

  const searchExplicit = Object.keys(search).length > 0 || Object.keys(web).length > 0;
  const searchEnabled = searchExplicit ? search.enabled !== false : false;
  const provider =
    typeof search.provider === "string" && search.provider.trim() ? search.provider.trim() : null;
  const hasKeyClue = hasWebSearchKeyClue(root, search) || Boolean(envHints?.hasBraveApiKey);
  const keyFreeProvider =
    provider === "duckduckgo" || provider === "searxng" || provider === "ollama";
  const webSearchReady = Boolean(
    searchEnabled && provider && (hasKeyClue || keyFreeProvider),
  );

  const fetchExplicit = Object.keys(fetchCfg).length > 0;
  const fetchEnabled = fetchExplicit ? fetchCfg.enabled !== false : searchEnabled;
  const webFetchReady = fetchEnabled && searchEnabled;

  const browserExplicit = Object.keys(browser).length > 0;
  const browserEnabledFlag = browserExplicit ? browser.enabled !== false : false;
  const browserAllowlisted = alsoAllow.includes("browser") || allow.includes("browser");
  const browserReady = browserEnabledFlag || browserAllowlisted;

  return {
    webSearch: {
      enabled: searchEnabled,
      ready: webSearchReady,
      detail: webSearchReady
        ? `enabled${provider ? `; provider=${provider}` : ""}${hasKeyClue ? "; key_clue=yes" : ""}`
        : searchEnabled
          ? "enabled but missing provider/key clue"
          : "not configured (product does not use web_search)",
    },
    webFetch: {
      enabled: fetchEnabled,
      ready: webFetchReady,
      detail: webFetchReady ? "enabled with web tools" : "not ready",
    },
    browser: {
      enabled: browserEnabledFlag || browserAllowlisted,
      ready: browserReady,
      detail: browserReady
        ? browserEnabledFlag
          ? "browser.enabled"
          : "allowlisted via tools.allow/alsoAllow"
        : "not configured (product default should enable browser)",
    },
  };
}

/**
 * 解析 JSON 文本；失败返回空配置摘要。
 *
 * @param text openclaw.json 文本
 * @returns 能力摘要
 */
export function summarizeOpenClawToolCapabilitiesFromText(
  text: string,
  envHints?: { hasBraveApiKey?: boolean } | null,
): OpenClawToolCapabilitySummary {
  try {
    return summarizeOpenClawToolCapabilities(JSON.parse(text) as unknown, envHints);
  } catch {
    return summarizeOpenClawToolCapabilities(null, envHints);
  }
}

/**
 * job 是否需要联网/浏览器类 OpenClaw 工具。
 *
 * @param input goal 与权限
 * @returns 需求类别；不需要则 null
 */
export function classifyJobWebCapabilityNeed(input: {
  goal?: string | null;
  allowedPermissions?: readonly string[] | null;
}): "web_search" | "browser" | "network" | null {
  const goal = permissionInferenceText(input.goal);
  const perms = Array.isArray(input.allowedPermissions) ? input.allowedPermissions : [];
  const hasNetwork = perms.includes("network.access");
  const lower = goal.toLowerCase();
  const wantsBrowser =
    /浏览器|打开网页|webpage|browser|点击|gui/.test(goal) || /browser/.test(lower);
  const wantsSearch =
    /搜索|搜一下|查.{0,8}(价格|新闻|网页|资料)|web_search|google|bing/.test(goal) ||
    /search|news|price/.test(lower);
  // 产品不走 web_search：搜索/联网意图一律按 browser（或 network→browser 就绪）验收。
  if (wantsBrowser || wantsSearch) {
    return "browser";
  }
  if (hasNetwork || /https?:\/\//i.test(goal) || /联网|网页/.test(goal)) {
    return "network";
  }
  return null;
}

/**
 * 查资料类意图是否需要浏览器主路径权限。
 *
 * @param input goal 与已声明权限
 * @returns 需要则 true
 */
export function needsBrowserResearchPermissions(input: {
  goal?: string | null;
  allowedPermissions?: readonly string[] | null;
}): boolean {
  return classifyJobWebCapabilityNeed(input) != null;
}

/**
 * 为查资料意图并入 desktop.control + network.access（弹权前可见补全，非静默授权）。
 *
 * @param permissions 已校验权限
 * @param goal job 目标
 * @returns 补全后的权限列表（去重保序）
 */
export function enrichPermissionsForWebResearch(
  permissions: readonly PermissionId[],
  goal: string | null | undefined,
): PermissionId[] {
  if (!needsBrowserResearchPermissions({ ...(goal !== undefined ? { goal } : {}), allowedPermissions: permissions })) {
    return [...permissions];
  }
  const out: PermissionId[] = [];
  const seen = new Set<string>();
  for (const id of ["desktop.control", "network.access", ...permissions] as PermissionId[]) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  // 保持调用方原有权限在前的观感：先补 desktop/network，再追加其余
  const preferred: PermissionId[] = [];
  for (const id of ["desktop.control", "network.access"] as const) {
    if (out.includes(id)) {
      preferred.push(id);
    }
  }
  for (const id of out) {
    if (id !== "desktop.control" && id !== "network.access") {
      preferred.push(id);
    }
  }
  return preferred;
}

/**
 * 能力是否满足 job 联网意图。
 *
 * @param summary 能力摘要
 * @param need 需求
 * @returns 是否满足
 */
export function openClawCapabilitySatisfies(
  summary: OpenClawToolCapabilitySummary,
  need: "web_search" | "browser" | "network",
): boolean {
  if (need === "browser") {
    return summary.browser.ready;
  }
  if (need === "web_search") {
    // 兼容旧枚举：产品以 browser 满足，不再要求 web_search 配置。
    return summary.browser.ready || summary.webSearch.ready;
  }
  return summary.browser.ready || summary.webFetch.ready || summary.webSearch.ready;
}

function hasWebSearchKeyClue(root: Record<string, unknown>, search: Record<string, unknown>): boolean {
  if (search.apiKey != null && String(search.apiKey).trim()) {
    return true;
  }
  const plugins = isRecord(root.plugins) ? root.plugins : {};
  const entries = isRecord(plugins.entries) ? plugins.entries : {};
  for (const value of Object.values(entries)) {
    if (!isRecord(value)) {
      continue;
    }
    const cfg = isRecord(value.config) ? value.config : {};
    const webSearch = isRecord(cfg.webSearch) ? cfg.webSearch : {};
    if (webSearch.apiKey != null && String(webSearch.apiKey).trim()) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
