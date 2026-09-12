/**
 * OpenClaw 能力摘要与 job 预检单测。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyJobWebCapabilityNeed,
  enrichPermissionsForWebResearch,
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

test("查价 goal 仅 network.access 时补全 desktop.control", () => {
  const enriched = enrichPermissionsForWebResearch(
    ["network.access", "workspace.read"],
    "查询BNB当前价格",
  );
  assert.ok(enriched.includes("desktop.control"));
  assert.ok(enriched.includes("network.access"));
  assert.ok(enriched.includes("workspace.read"));
  assert.equal(enriched[0], "desktop.control");
  assert.equal(enriched[1], "network.access");
});

test("本地读盘 goal 不无故塞入 desktop.control", () => {
  const enriched = enrichPermissionsForWebResearch(["workspace.read"], "列出工作区根目录文件");
  assert.deepEqual(enriched, ["workspace.read"]);
});

test("搜索类 goal 归为 browser；仅 web_search 配置不得顶替 browser", () => {
  assert.equal(
    classifyJobWebCapabilityNeed({
      goal: "打开浏览器搜索BNB当前价格并获取结果",
      allowedPermissions: ["network.access"],
    }),
    "browser",
  );
  assert.equal(
    classifyJobWebCapabilityNeed({
      goal: "搜索一下今天新闻",
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
  assert.equal(
    openClawCapabilitySatisfies(
      summarizeOpenClawToolCapabilities({ browser: { enabled: true } }),
      "browser",
    ),
    true,
  );
  assert.equal(
    openClawCapabilitySatisfies(
      summarizeOpenClawToolCapabilities({ browser: { enabled: true } }),
      "web_search",
    ),
    true,
  );
});
