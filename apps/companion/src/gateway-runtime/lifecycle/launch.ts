/**
 * Gateway 启动文件与环境装配。
 * 职责：写隔离配置，构造子进程环境和脱敏日志端口。
 * 不拥有：进程重启策略、job 与权限。副作用：写本地配置；密钥只进入进程环境。
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { generateOpenClawConfig, providerMeta, OPENCLAW_MODEL_KEY_ENV, OPENCLAW_BRAVE_KEY_ENV } from "../openclaw-config.js";
import { redactOpenClawRuntimeLine } from "../redact-runtime-line.js";
import { findFreePort, DEFAULT_STARTUP_TIMEOUT_MS, type GatewayRuntimeManagerOptions } from "../manager.js";
import type { GatewayRuntimeServiceOptions, StartGatewayRuntimeInput } from "./types.js";

export async function prepareGatewayLaunch(input: StartGatewayRuntimeInput, options: GatewayRuntimeServiceOptions) {
    const meta = providerMeta(input.provider, input.endpoint, input.modelRef);
    const token = randomBytes(16).toString("hex");
    const port = await findFreePort();
    const stateDir = options.stateDir;
    fs.mkdirSync(stateDir, { recursive: true });
    const logFile = options.logFile ?? path.join(stateDir, "logs", "openclaw-runtime.log");
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const configText = generateOpenClawConfig({
      token: token,
      port,
      modelRef: input.modelRef,
      providerId: meta.providerId,
      withApiKey: meta.needsKey && input.apiKey.trim().length > 0,
      baseUrl: meta.baseUrl,
      workspace: input.workspace,
      logFile,
      webTools: {
        enableWebSearch: input.enableWebSearch === true,
        enableBrowser: true,
        withWebSearchApiKey: Boolean(input.webSearchApiKey?.trim()),
        browserProxyEnabled: input.browserProxyEnabled === true,
        browserProxyUrl: input.browserProxyUrl ?? null,
      },
    });
    fs.writeFileSync(path.join(stateDir, "openclaw.json"), configText, "utf8");

    const env = buildGatewayEnvironment(input, meta.needsKey);
    const managerOptions: GatewayRuntimeManagerOptions = {
      openclawEntry: options.openclawEntry,
      stateDir,
      token: token,
      port,
      host: options.host ?? "127.0.0.1",
      env,
      startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    };
    if (options.nodeBin) {
      managerOptions.nodeBin = options.nodeBin;
    }
    if (options.logger) {
      managerOptions.logger = options.logger;
      managerOptions.onStdout = (line) =>
        options.logger?.info(
          { stream: "stdout", line: redactOpenClawRuntimeLine(line) },
          "OpenClaw stdout",
        );
      managerOptions.onStderr = (line) =>
        options.logger?.error(
          { stream: "stderr", line: redactOpenClawRuntimeLine(line) },
          "OpenClaw stderr",
        );
    }
    return { token, managerOptions };
}

function buildGatewayEnvironment(input: StartGatewayRuntimeInput, needsKey: boolean): Record<string, string> {
    const env: Record<string, string> = {
      OPENCLAW_SKIP_CHANNELS: "1",
    };
    if (needsKey && input.apiKey.trim()) {
      env[OPENCLAW_MODEL_KEY_ENV] = input.apiKey.trim();
    }
    if (input.webSearchApiKey?.trim()) {
      env[OPENCLAW_BRAVE_KEY_ENV] = input.webSearchApiKey.trim();
    }
    const proxyUrl = input.browserProxyUrl?.trim() ?? "";
    if (input.browserProxyEnabled === true && proxyUrl) {
      // 与 browser.extraArgs 同源；覆盖父进程残留，供 web_fetch useTrustedEnvProxy 使用。
      env.HTTP_PROXY = proxyUrl;
      env.HTTPS_PROXY = proxyUrl;
      env.http_proxy = proxyUrl;
      env.https_proxy = proxyUrl;
      // 模型 API 不得被本机死代理拖死（Clash 未开时常见）。
      const noProxy =
        "127.0.0.1,localhost,::1,.aliyuncs.com,dashscope.aliyuncs.com,.openai.com,api.openai.com";
      env.NO_PROXY = noProxy;
      env.no_proxy = noProxy;
    } else {
      // 显式清空，避免 ...process.env 继承系统/父进程代理。
      env.HTTP_PROXY = "";
      env.HTTPS_PROXY = "";
      env.http_proxy = "";
      env.https_proxy = "";
      env.NO_PROXY = "";
      env.no_proxy = "";
    }
    return env;
}
