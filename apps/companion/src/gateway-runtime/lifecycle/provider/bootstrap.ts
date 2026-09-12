/**
 * 自托管 provider 冷启动准备。
 * 职责：为已验证的打包 runtime 安装精确版本的 Qwen 插件，避免逐版本试探 latest。
 * 不拥有：模型凭据、权限裁决或 core 修改。副作用：调用官方 CLI，安装到隔离 state。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { createGatewayEnvironment } from "../environment.js";
import type { GatewayRuntimeServiceOptions, StartGatewayRuntimeInput } from "../types.js";

const QWEN_PACKAGE = "@openclaw/qwen-provider";
const QWEN_VERSION = "2026.7.1";
const QWEN_SEED_ARCHIVE = `qwen-provider-${QWEN_VERSION}.tgz`;
const VERIFIED_RUNTIME_VERSION = "2026.7.1-2";
const BOOTSTRAP_TIMEOUT_MS = 180_000;

/** 仅匹配产品已验证的外置 provider/runtime 组合；其他入口保持其原安装方式。 */
export function needsPinnedQwenBootstrap(entry: string, provider: string): boolean {
  if (provider !== "qwen") return false;
  for (const dir of [path.dirname(entry), path.dirname(path.dirname(entry))]) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (manifest.name === "openclaw") return manifest.version === VERIFIED_RUNTIME_VERSION;
    } catch { /* 非打包 runtime 或不存在的候选，不猜测版本。 */ }
  }
  return false;
}

/** 检查官方 CLI 的 npm 项目内是否有完整的匹配版本；残缺安装应交给 CLI 修复。 */
export function hasPinnedQwenPackage(stateDir: string): boolean {
  const projects = path.join(stateDir, "npm", "projects");
  if (!fs.existsSync(projects)) return false;
  return fs.readdirSync(projects).some((name) => {
    if (!name.startsWith("openclaw-qwen-provider-")) return false;
    const root = path.join(projects, name, "node_modules", "@openclaw", "qwen-provider");
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      return manifest.name === QWEN_PACKAGE && manifest.version === QWEN_VERSION && fs.existsSync(path.join(root, "dist", "index.js"));
    } catch { return false; }
  });
}

/** 查找随产品携带的 Qwen provider 离线 seed archive。 */
export function resolveQwenProviderSeedArchive(seedDir: string | null | undefined): string | null {
  const trimmed = seedDir?.trim();
  if (!trimmed) return null;
  const archive = path.join(trimmed, QWEN_SEED_ARCHIVE);
  return fs.existsSync(archive) ? archive : null;
}

function buildProviderInstallArgs(options: GatewayRuntimeServiceOptions): string[] {
  const seedArchive = resolveQwenProviderSeedArchive(options.providerSeedDir);
  if (seedArchive) {
    return [options.openclawEntry, "plugins", "install", seedArchive, "--force"];
  }
  if (options.allowProviderNetworkBootstrap === false) {
    throw new Error(`provider_seed_missing:qwen:${QWEN_SEED_ARCHIVE}`);
  }
  return [
    options.openclawEntry,
    "plugins",
    "install",
    `${QWEN_PACKAGE}@${QWEN_VERSION}`,
    "--pin",
    "--force",
  ];
}

/** 安装器无模型凭据；取消/超时终止自己启动的 CLI 进程树，不留下 npm 子进程。 */
function installProvider(options: GatewayRuntimeServiceOptions, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const env = createGatewayEnvironment({ parent: process.env, stateDir: options.stateDir, port: 0 });
  Object.assign(env, { OPENCLAW_CONFIG_PATH: path.join(options.stateDir, "provider-bootstrap.json"),
    OPENCLAW_SKIP_CHANNELS: "1", HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" });
  const args = buildProviderInstallArgs(options);
  return new Promise((resolve, reject) => {
    const child = spawn(options.nodeBin ?? process.execPath,
      args,
      { env, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    let interruption: Error | null = null;
    const stop = (reason: string): void => {
      if (interruption) return;
      interruption = new Error(reason);
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
      } else child.kill("SIGTERM");
    };
    const abort = (): void => stop("provider_bootstrap_canceled");
    const timer = setTimeout(() => stop("provider_bootstrap_timeout"), BOOTSTRAP_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => {
      cleanup();
      if (interruption || code !== 0) reject(interruption ?? new Error(`provider_bootstrap_failed:${code}`));
      else resolve();
    });
  });
}

/** 在 Gateway 写入带模型引用的正式配置之前完成官方 provider 安装。 */
export async function prepareRuntimeProvider(
  input: StartGatewayRuntimeInput, options: GatewayRuntimeServiceOptions, signal: AbortSignal,
): Promise<void> {
  if (!needsPinnedQwenBootstrap(options.openclawEntry, input.provider) || hasPinnedQwenPackage(options.stateDir)) return;
  fs.mkdirSync(options.stateDir, { recursive: true });
  options.logger?.info({ provider: "qwen", version: QWEN_VERSION }, "准备自托管模型组件");
  await installProvider(options, signal);
  if (!hasPinnedQwenPackage(options.stateDir)) throw new Error("provider_bootstrap_package_missing");
}
