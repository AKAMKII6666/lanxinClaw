/**
 * OpenClaw 能力摘要与 job 预检单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyJobWebCapabilityNeed,
  openClawCapabilitySatisfies,
  summarizeOpenClawToolCapabilities,
} from "../../src/gateway-runtime/openclaw-capability.js";

test("未配置 tools 时 web/browser 默认不 ready", () => {
  const summary = summarizeOpenClawToolCapabilities({
    gateway: { port: 1 },
  });
  assert.equal(summary.webSearch.ready, false);
  assert.equal(summary.browser.ready, false);
});

test("显式 web.search + brave key 线索后 ready", () => {
  const summary = summarizeOpenClawToolCapabilities(
    {
      tools: {
        web: { search: { enabled: true, provider: "brave" } },
        alsoAllow: ["group:web"],
      },
    },
    { hasBraveApiKey: true },
  );
  assert.equal(summary.webSearch.ready, true);
  assert.ok(!JSON.stringify(summary).includes("sk-"));
});

test("browser.enabled 或 alsoAllow browser 记为 ready", () => {
  const byFlag = summarizeOpenClawToolCapabilities({
    browser: { enabled: true },
  });
  assert.equal(byFlag.browser.ready, true);
  const byAllow = summarizeOpenClawToolCapabilities({
    tools: { alsoAllow: ["browser"] },
  });
  assert.equal(byAllow.browser.ready, true);
});

test("纯本地读盘 goal 不需要 web capability", () => {
  assert.equal(
    classifyJobWebCapabilityNeed({
      goal: "列出工作区根目录文件",
      allowedPermissions: ["workspace.read"],
    }),
    null,
  );
});

test("联网搜索 goal 需要 browser 时不得用 web_search 顶替", () => {
  assert.equal(
    classifyJobWebCapabilityNeed({
      goal: "打开浏览器搜索BNB当前价格并获取结果",
      allowedPermissions: ["network.access"],
    }),
    "browser",
  );
  const searchOnly = summarizeOpenClawToolCapabilities(
    {
      tools: {
        web: { search: { enabled: true, provider: "brave" } },
        alsoAllow: ["group:web"],
      },
    },
    { hasBraveApiKey: true },
  );
  assert.equal(searchOnly.webSearch.ready, true);
  assert.equal(searchOnly.browser.ready, false);
  assert.equal(openClawCapabilitySatisfies(searchOnly, "browser"), false);
  assert.equal(openClawCapabilitySatisfies(searchOnly, "web_search"), true);
  assert.equal(
    openClawCapabilitySatisfies(
      summarizeOpenClawToolCapabilities({ browser: { enabled: true } }),
      "browser",
    ),
    true,
  );
});
