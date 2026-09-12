/** 子进程环境边界回归：其他模型凭据不得触发 OpenClaw 自动插件配置。 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { createGatewayEnvironment } from "../../src/gateway-runtime/lifecycle/environment.js";

test("隔离父进程模型凭据和 OpenClaw 实例，只保留显式配置与 OS 环境", () => {
  const parent = { PATH: "node-bin", SystemRoot: "windows", USERPROFILE: "user-home",
    DEEPSEEK_API_KEY: "unrelated-fixture", OPENAI_API_KEY: "other-fixture",
    GITHUB_TOKEN: "token-fixture", GOOGLE_APPLICATION_CREDENTIALS: "credential-fixture",
    openclaw_home: "other-home", OPENCLAW_CONFIG_PATH: "other-config",
    LANXIN_OPENCLAW_API_KEY: "old-fixture" };
  const env = createGatewayEnvironment({ parent, stateDir: "isolated", port: 4321,
    explicit: { LANXIN_OPENCLAW_API_KEY: "selected-fixture", OPENCLAW_SKIP_CHANNELS: "1",
      OPENCLAW_CONFIG_PATH: "cannot-override-boundary" } });
  assert.deepEqual(env, { PATH: "node-bin", SystemRoot: "windows", USERPROFILE: "user-home",
    LANXIN_OPENCLAW_API_KEY: "selected-fixture", OPENCLAW_SKIP_CHANNELS: "1",
    OPENCLAW_STATE_DIR: "isolated", OPENCLAW_CONFIG_PATH: path.join("isolated", "openclaw.json"),
    OPENCLAW_OAUTH_DIR: path.join("isolated", "credentials"), OPENCLAW_GATEWAY_PORT: "4321" });
  assert.equal(parent.DEEPSEEK_API_KEY, "unrelated-fixture");
});
