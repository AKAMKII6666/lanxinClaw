/**
 * Electron 壳运行时与启动选项契约。
 *
 * 职责：描述 main 可注入的 Electron 最小面与路径覆盖。
 * 不拥有：窗口生命周期、协议 server、Gateway。
 * 纯函数：仅类型。
 */

import type { OpenClawAdapter } from "@lanxin-claw/openclaw-adapter";
import type { GatewayRuntimeService } from "../../gateway-runtime/service.js";
import type { BrowserWindowConstructor } from "./create-window.js";
import type { TrayConstructor, TrayMenuBuilder } from "./create-tray.js";
import type { QuitConfirmDialog } from "./quit-confirm.js";

/**
 * Electron 运行时最小面，便于测试替换。
 */
export interface ElectronRuntime {
  /** app 模块 */
  app: {
    whenReady(): Promise<void>;
    quit(): void;
    relaunch?(): void;
    on(event: "window-all-closed" | "will-quit", listener: () => void): void;
    on(event: "before-quit", listener: (event: { preventDefault(): void }) => void): void;
    /** 读取应用用户数据目录（可选；缺省回退内存/仓库目录） */
    getPath?(name: string): string;
    getAppPath?(): string;
    /** Electron 打包态标记；打包后禁用 provider 联网 bootstrap */
    isPackaged?: boolean;
    getLoginItemSettings?(): { openAtLogin: boolean };
    setLoginItemSettings?(settings: { openAtLogin: boolean }): void;
  };
  /** BrowserWindow 构造器 */
  BrowserWindow: BrowserWindowConstructor;
  /** Tray 构造器 */
  Tray: TrayConstructor;
  /** Menu 构建器 */
  Menu: TrayMenuBuilder;
  /** nativeImage 工厂 */
  nativeImage: {
    createEmpty(): unknown;
    createFromPath?(iconPath: string): unknown;
  };
  dialog?: QuitConfirmDialog;
  /** 可选 ipcMain；缺省则跳过 bridge 注册（纯壳单测） */
  ipcMain?: {
    handle(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown,
    ): void;
  };
  /** 可选 safeStorage 适配（Windows DPAPI）；不可用时拒绝落盘明文 */
  safeStorage?: {
    isEncryptionAvailable(): boolean;
    encryptString(plain: string): string | Buffer;
    decryptString(encrypted: string | Buffer): string;
  };
  /** 打开日志目录等 */
  shell?: {
    openPath(target: string): Promise<string>;
  };
  /** 桌面通知构造器；缺省只写日志 */
  Notification?: (new (options: { title: string; body: string }) => { show(): void }) & {
    isSupported?: () => boolean;
  };
}

/**
 * 启动壳时的路径覆盖。
 */
export interface StartCompanionShellOptions {
  /** 用于默认路径；显式路径优先 */
  metaUrl?: string;
  /** preload 绝对路径 */
  preloadPath?: string;
  /** 打包 renderer HTML */
  rendererHtmlPath?: string;
  /** 开发期 Vite URL，如 http://127.0.0.1:5173/ */
  rendererUrl?: string;
  /** 是否启动桌面 phone protocol server；入口默认启用，单测可关闭 */
  protocolServer?: {
    enabled: boolean;
    port?: number;
    /** 监听 host；缺省取 LANXIN_PROTOCOL_HOST 或 127.0.0.1 */
    host?: string;
  };
  /** 是否启动 mDNS 广告；缺省跟随 protocolServer.enabled */
  discovery?: { enabled?: boolean };
  /** 日志目录覆盖；缺省 userData/logs 或 runtime/logs */
  logDir?: string;
  /** 注入 adapter；缺省 local-safe 只读 runtime */
  adapter?: OpenClawAdapter;
  /** job 轮询间隔毫秒；缺省 2000 */
  jobPollIntervalMs?: number;
  /** 自托管 openclaw 入口（openclaw.mjs 或 dist/index.js）；缺省读 LANXIN_OPENCLAW_ENTRY */
  openclawEntry?: string;
  /** 自托管 state 目录；缺省 userData/openclaw-runtime */
  openclawStateDir?: string;
  /** agent 工作区；缺省 LANXIN_OPENCLAW_WORKSPACE_ROOT 或 stateDir/workspace */
  workspace?: string;
  /** 注入 gateway 运行时服务（测试用） */
  gatewayService?: GatewayRuntimeService;
}
