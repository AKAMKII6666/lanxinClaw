/**
 * shell-settings 浏览器代理校验单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_BROWSER_PROXY_URL,
  normalizeShellSettings,
  parseBrowserProxyUrl,
} from "../../../src/shell/desktop/shell-settings.js";

test("parseBrowserProxyUrl 仅允许 localhost/127.0.0.1", () => {
  assert.equal(parseBrowserProxyUrl("http://127.0.0.1:7890").ok, true);
  assert.equal(parseBrowserProxyUrl("http://localhost:7890").ok, true);
  assert.equal(parseBrowserProxyUrl("https://example.com:7890").ok, false);
  assert.equal(parseBrowserProxyUrl("socks5://127.0.0.1:7890").ok, false);
  assert.equal(parseBrowserProxyUrl("http://user:pass@127.0.0.1:7890").ok, false);
});

test("normalizeShellSettings 默认开代理", () => {
  const prefs = normalizeShellSettings(null, "127.0.0.1");
  assert.equal(prefs.browserProxyEnabled, true);
  assert.equal(prefs.browserProxyUrl, DEFAULT_BROWSER_PROXY_URL);
  assert.equal(prefs.listenHost, "127.0.0.1");
});

test("normalizeShellSettings 显式 false 保持关闭", () => {
  const prefs = normalizeShellSettings(
    { browserProxyEnabled: false, browserProxyUrl: DEFAULT_BROWSER_PROXY_URL },
    "127.0.0.1",
  );
  assert.equal(prefs.browserProxyEnabled, false);
});
