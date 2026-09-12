/**
 * 自托管进程环境边界。
 * 职责：保留操作系统执行环境，隔离父进程凭据与其他 OpenClaw 实例配置。
 * 不拥有：凭据读取、模型选择或进程启动。纯函数：只注入调用方明确提供的运行时配置。
 */
import path from "node:path";

export function createGatewayEnvironment(input: {
  parent: NodeJS.ProcessEnv;
  stateDir: string;
  port: number;
  explicit?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(input.parent).filter(([name]) =>
    !/^(?:OPENCLAW|CLAWDBOT|MOLTBOT|LANXIN)_/i.test(name) &&
    !/(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|AUTHORIZATION)(?:_|$)/i.test(name),
  ));
  return {
    ...inherited,
    ...(input.explicit ?? {}),
    OPENCLAW_STATE_DIR: input.stateDir,
    OPENCLAW_CONFIG_PATH: path.join(input.stateDir, "openclaw.json"),
    OPENCLAW_OAUTH_DIR: path.join(input.stateDir, "credentials"),
    OPENCLAW_GATEWAY_PORT: String(input.port),
  };
}
