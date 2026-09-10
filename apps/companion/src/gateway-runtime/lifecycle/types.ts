/** Gateway 服务生命周期合同；只声明选项与句柄，不运行进程。 */
import {
OpenClawAdapter,
type AdapterJobStore
} from "@lanxin-claw/openclaw-adapter";
import type { Logger } from "pino";


/** 服务选项 */
export interface GatewayRuntimeServiceOptions {
  /** openclaw 入口（openclaw.mjs 或 dist/index.js 绝对路径） */
  openclawEntry: string;
  /** node 可执行文件；缺省 process.execPath */
  nodeBin?: string;
  /** 隔离 state 目录（含 openclaw.json 与 credentials） */
  stateDir: string;
  /** 监听 host；默认 127.0.0.1 */
  host?: string;
  /** OpenClaw 自身日志文件；默认 <stateDir>/logs/openclaw-runtime.log */
  logFile?: string;
  /** 首次崩溃重启延迟毫秒；之后指数退避。默认 1000 */
  restartDelayMs?: number;
  /** 连续自动重启上限；默认 8 */
  maxRestartAttempts?: number;
  /** 启动超时毫秒；默认 300000，包含首次模型 provider 安装 */
  startupTimeoutMs?: number;
  /** 日志 */
  logger?: Logger;
  /** adapter job store；Electron main 注入文件实现 */
  adapterJobStore?: AdapterJobStore;
}

/** 启动入参（来自 onboarding 配置 + 工作区） */
export interface StartGatewayRuntimeInput {
  /** 模型 provider 标识 */
  provider: string;
  /** 模型 API key（仅内存，注入子进程 env） */
  apiKey: string;
  /** provider 端点（openai-compatible/local） */
  endpoint: string | null;
  /** 模型引用（provider/model） */
  modelRef: string;
  /** agent 工作区 */
  workspace: string;
  /** 用户同意启用网页搜索 */
  enableWebSearch?: boolean;
  /** 用户同意启用 browser */
  enableBrowser?: boolean;
  /** web search API key（仅 env，不入 json） */
  webSearchApiKey?: string;
  /** 托管浏览器走本地代理；默认 false */
  browserProxyEnabled?: boolean;
  /** 本地代理 URL */
  browserProxyUrl?: string | null;
}

/** 运行句柄 */
export interface GatewayRuntimeHandle {
  /** WebSocket URL */
  url: string;
  /** 本地 token */
  token: string;
  /** 已连 runtime 的 adapter */
  adapter: OpenClawAdapter;
  /** 停止并清理 */
  stop: () => Promise<void>;
}
