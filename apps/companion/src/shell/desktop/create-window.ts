/**
 * Electron 主窗口创建。
 *
 * 职责：创建 BrowserWindow 并加载 renderer；默认开启 contextIsolation。
 * 不拥有：pairing、权限裁决、OpenClaw；业务 IPC 由 bridge 注册。
 * 副作用：创建原生窗口；不直接访问文件系统/命令。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 最小 BrowserWindow 构造契约，便于单测注入而不强绑 electron 运行时。
 */
export interface BrowserWindowLike {
  /** 加载本地 HTML */
  loadFile(filePath: string): Promise<void>;
  /** 加载开发期 Vite URL */
  loadURL(url: string): Promise<void>;
  /** 窗口关闭事件 */
  on(event: "closed", listener: () => void): void;
}

/**
 * BrowserWindow 构造器契约。
 */
export type BrowserWindowConstructor = new (options: {
  width: number;
  height: number;
  show: boolean;
  webPreferences: {
    preload: string;
    contextIsolation: boolean;
    nodeIntegration: boolean;
    sandbox: boolean;
  };
}) => BrowserWindowLike;

/**
 * 创建主窗口的选项。
 */
export interface CreateMainWindowOptions {
  /** BrowserWindow 构造器（通常来自 electron） */
  BrowserWindow: BrowserWindowConstructor;
  /** preload 脚本绝对路径 */
  preloadPath: string;
  /** 打包后的 renderer HTML 绝对路径；与 rendererUrl 二选一 */
  rendererHtmlPath?: string;
  /** 开发期 Vite URL；优先于 rendererHtmlPath */
  rendererUrl?: string;
}

/**
 * 解析默认 UI 资源路径（相对本模块源码位置；生产由 main-entry 覆盖）。
 *
 * @param metaUrl import.meta.url
 * @returns preload 与 html 路径
 */
export function resolveDefaultUiPaths(metaUrl: string): {
  preloadPath: string;
  rendererHtmlPath: string;
} {
  const here = path.dirname(fileURLToPath(metaUrl));
  return {
    preloadPath: path.join(here, "preload.cjs"),
    rendererHtmlPath: path.resolve(here, "../../../ui/index.html"),
  };
}

/**
 * 创建澜星 Claw 主窗口；renderer 无 nodeIntegration。
 *
 * @param options 构造依赖与资源路径
 * @returns 窗口实例
 */
export async function createMainWindow(
  options: CreateMainWindowOptions,
): Promise<BrowserWindowLike> {
  const win = new options.BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (options.rendererUrl) {
    await win.loadURL(options.rendererUrl);
    return win;
  }
  if (!options.rendererHtmlPath) {
    throw new Error("createMainWindow 需要 rendererUrl 或 rendererHtmlPath");
  }
  await win.loadFile(options.rendererHtmlPath);
  return win;
}
