/**
 * Companion shell 偏好（非密钥）。
 *
 * 职责：shell-settings.json 形状、默认值、浏览器本地代理 URL 校验。
 * 不拥有：Gateway 进程、openclaw.json 写入、凭据。
 * 纯函数：无 I/O。
 */

import type { ProtocolListenHost } from "../session/listen-host.js";

/** 默认本地代理地址（Clash 常见端口） */
export const DEFAULT_BROWSER_PROXY_URL = "http://127.0.0.1:7890";

/**
 * shell-settings.json 持久化形状。
 */
export interface CompanionShellSettings {
  /** 协议监听地址 */
  listenHost: ProtocolListenHost;
  /** 是否让托管浏览器走本地代理；默认 true */
  browserProxyEnabled: boolean;
  /** 本地代理 URL；默认 http://127.0.0.1:7890 */
  browserProxyUrl: string;
}

/**
 * 校验本地浏览器代理 URL：仅 http(s)://127.0.0.1 或 localhost。
 *
 * @param raw 用户输入
 * @returns 规范化 URL 或错误码
 */
export function parseBrowserProxyUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; code: string; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, code: "browser_proxy_url_empty", message: "代理地址不能为空" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, code: "browser_proxy_url_invalid", message: "代理地址不是合法 URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, code: "browser_proxy_url_scheme", message: "代理仅支持 http 或 https" };
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") {
    return {
      ok: false,
      code: "browser_proxy_url_host",
      message: "代理仅允许 127.0.0.1 或 localhost",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: "browser_proxy_url_auth",
      message: "代理 URL 不得包含用户名或密码",
    };
  }
  return { ok: true, url: parsed.toString().replace(/\/$/, "") };
}

/**
 * 合并磁盘值与默认值。
 *
 * @param partial 磁盘或入参片段
 * @param defaultListenHost 默认监听地址
 * @returns 完整 settings
 */
export function normalizeShellSettings(
  partial: Partial<CompanionShellSettings> | null | undefined,
  defaultListenHost: ProtocolListenHost,
): CompanionShellSettings {
  const enabled = partial?.browserProxyEnabled !== false;
  const urlParse = parseBrowserProxyUrl(partial?.browserProxyUrl ?? DEFAULT_BROWSER_PROXY_URL);
  return {
    listenHost: partial?.listenHost ?? defaultListenHost,
    browserProxyEnabled: enabled,
    browserProxyUrl: urlParse.ok ? urlParse.url : DEFAULT_BROWSER_PROXY_URL,
  };
}
