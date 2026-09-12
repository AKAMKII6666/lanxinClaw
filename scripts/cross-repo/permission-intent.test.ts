/** 实机回归：禁止联网不得反向扩权或添加 browser 指令；phone 与桌面使用同一规则。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permissionInferenceText } from "@lanxin-claw/protocol";
import { enrichPermissionsForWebResearch } from "../../apps/companion/src/gateway-runtime/openclaw-capability.js";
import { OpenClawAdapter, createMutableMockOpenClawRuntimeClient } from "../../packages/openclaw-adapter/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const phoneRoot = path.resolve(process.env.LANXIN_PHONE_REPO || path.join(repoRoot, "../doubaoSister"));
const require = createRequire(import.meta.url);
const phone = require(path.join(phoneRoot, "phone/systems/lanxinClaw/companionTools.js"));
const phoneIntent = require(path.join(phoneRoot, "phone/systems/lanxinClaw/permissionIntentText.js"));

test("明确禁止联网/浏览器的只读目标在 phone、授权卡、委派输入上都不反向扩权", async () => {
  const goals = [
    "读取 acceptance-canary.txt，不要执行命令，不要联网。",
    "禁止使用浏览器、搜索或访问网页；读取本地报告。",
    "不要联网但读取本地文件",
    "读取文件，不联网。",
    "Read the local file. Do not use the browser or search the internet.",
    "Read the local file without web access",
    "Read the local file, don't use network or browser tools",
  ];
  for (const [index, goal] of goals.entries()) {
    assert.equal(phoneIntent.permissionInferenceText(goal), permissionInferenceText(goal));
    const resolved = phone.resolveAllowedPermissions(["workspace.read"], goal);
    assert.deepEqual(resolved.permissions, ["workspace.read"], goal);
    assert.deepEqual(enrichPermissionsForWebResearch(resolved.permissions, goal), ["workspace.read"], goal);
    const { client } = createMutableMockOpenClawRuntimeClient();
    const createRun = client.createRun.bind(client);
    let inputText: string | undefined;
    client.createRun = async (input) => { inputText = input.input; return createRun(input); };
    const created = await new OpenClawAdapter({ runtime: client }).createJob({
      jobId: `job_negative_${index}`, affairId: `affair_negative_${index}`, goal, allowedPermissions: ["workspace.read"],
    });
    assert.equal(created.ok, true);
    assert.equal(inputText, goal, "原始限制完整保留，且不得添加浏览器前缀");
  }
});

test("正面联网目标仍提示权限，显式权限不被否定语句静默移除", () => {
  for (const goal of ["联网搜索新闻", "不要修改文件，但用浏览器搜索新闻", "Do not write files, but search the web"]) {
    const resolved = phone.resolveAllowedPermissions(["workspace.read"], goal);
    assert.ok(resolved.permissions.includes("network.access"), goal);
    assert.ok(enrichPermissionsForWebResearch(resolved.permissions, goal).includes("desktop.control"), goal);
  }
  assert.ok(phone.resolveAllowedPermissions(["network.access"], "不要联网").permissions.includes("network.access"));
});
