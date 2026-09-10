/** provider 准备的版本锁定、凭据边界、残缺修复与取消清理。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareRuntimeProvider, hasPinnedQwenPackage } from "../../src/gateway-runtime/lifecycle/provider/bootstrap.js";

function fixture(hang = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-provider-test-"));
  const entry = path.join(root, "openclaw.cjs");
  const stateDir = path.join(root, "state");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "openclaw", version: "2026.7.1-2" }));
  fs.writeFileSync(entry, `
    const fs = require('node:fs'), path = require('node:path');
    const state = process.env.OPENCLAW_STATE_DIR;
    fs.writeFileSync(path.join(state, 'invocation.json'), JSON.stringify({args:process.argv.slice(2),
      pid:process.pid, credentialPresent:!!process.env.LANXIN_OPENCLAW_API_KEY,
      config:process.env.OPENCLAW_CONFIG_PATH}));
    if (${hang}) { setInterval(()=>{},100); }
    else {
      const root=path.join(state,'npm/projects/openclaw-qwen-provider-test/node_modules/@openclaw/qwen-provider');
      fs.mkdirSync(path.join(root,'dist'),{recursive:true});
      fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@openclaw/qwen-provider',version:'2026.7.1'}));
      fs.writeFileSync(path.join(root,'dist/index.js'),'export {}');
    }
  `);
  return { openclawEntry: entry, stateDir };
}
const input = { provider: "qwen", apiKey: "model-key-must-not-reach-installer", endpoint: null,
  modelRef: "qwen/qwen3.5-plus", workspace: "fixture" };

test("外置 Qwen 使用精确官方包；安装器不收模型 key，完整安装幂等，残缺重新修复", async () => {
  const options = fixture();
  const signal = new AbortController().signal;
  await prepareRuntimeProvider(input, options, signal);
  const invocationFile = path.join(options.stateDir, "invocation.json");
  const invocation = JSON.parse(fs.readFileSync(invocationFile, "utf8"));
  assert.deepEqual(invocation.args, ["plugins", "install", "@openclaw/qwen-provider@2026.7.1", "--pin", "--force"]);
  assert.equal(invocation.credentialPresent, false);
  assert.equal(invocation.config, path.join(options.stateDir, "provider-bootstrap.json"));
  assert.equal(hasPinnedQwenPackage(options.stateDir), true);
  fs.unlinkSync(invocationFile);
  await prepareRuntimeProvider(input, options, signal);
  assert.equal(fs.existsSync(invocationFile), false);
  fs.unlinkSync(path.join(options.stateDir, "npm/projects/openclaw-qwen-provider-test/node_modules/@openclaw/qwen-provider/dist/index.js"));
  await prepareRuntimeProvider(input, options, signal);
  assert.equal(hasPinnedQwenPackage(options.stateDir), true);
  assert.equal(fs.existsSync(invocationFile), true);
});

test("取消冷启动会结束已启动的安装进程且不能报告组件就绪", async () => {
  const options = fixture(true), controller = new AbortController();
  const promise = prepareRuntimeProvider(input, options, controller.signal);
  const rejected = assert.rejects(promise, /provider_bootstrap_canceled/);
  const invocationFile = path.join(options.stateDir, "invocation.json");
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(invocationFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(invocationFile), true);
  const pid = JSON.parse(fs.readFileSync(invocationFile, "utf8")).pid;
  controller.abort();
  await rejected;
  assert.equal(hasPinnedQwenPackage(options.stateDir), false);
  assert.throws(() => process.kill(pid, 0));
});
