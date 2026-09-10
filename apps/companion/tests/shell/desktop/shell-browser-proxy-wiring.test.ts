/**
 * 浏览器代理热重启门闩单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSetBrowserProxyHandler,
  JOBS_RUNNING_PROXY_RESTART_BLOCKED,
} from "../../../src/shell/desktop/shell-browser-proxy-wiring.js";
import {
  DEFAULT_BROWSER_PROXY_URL,
  type CompanionShellSettings,
} from "../../../src/shell/desktop/shell-settings.js";

test("有 running job 时应用代理被拒且不写盘", async () => {
  let prefs: CompanionShellSettings = {
    browserProxyEnabled: false,
    browserProxyUrl: DEFAULT_BROWSER_PROXY_URL,
    listenHost: "127.0.0.1",
  };
  let persisted = 0;
  const handler = createSetBrowserProxyHandler({
    getShellPrefs: () => prefs,
    persistShellPrefs: (next) => {
      persisted += 1;
      prefs = next;
    },
    getOnboardingConfig: () => null,
    isOnboardingReady: () => false,
    gatewayService: null,
    workspace: "F:/ws",
    getDelegator: () => null,
    hasRunningJobs: () => true,
  });
  const result = await handler(true, "http://127.0.0.1:7890");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, JOBS_RUNNING_PROXY_RESTART_BLOCKED);
  }
  assert.equal(persisted, 0);
  assert.equal(prefs.browserProxyEnabled, false);
});

test("无 running job 时可写盘", async () => {
  let prefs: CompanionShellSettings = {
    browserProxyEnabled: false,
    browserProxyUrl: DEFAULT_BROWSER_PROXY_URL,
    listenHost: "127.0.0.1",
  };
  const handler = createSetBrowserProxyHandler({
    getShellPrefs: () => prefs,
    persistShellPrefs: (next) => {
      prefs = next;
    },
    getOnboardingConfig: () => null,
    isOnboardingReady: () => false,
    gatewayService: null,
    workspace: "F:/ws",
    getDelegator: () => null,
    hasRunningJobs: () => false,
  });
  const result = await handler(true, "http://127.0.0.1:7890");
  assert.equal(result.ok, true);
  assert.equal(prefs.browserProxyEnabled, true);
  assert.equal(prefs.browserProxyUrl, "http://127.0.0.1:7890");
});
