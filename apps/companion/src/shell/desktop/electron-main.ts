/**
 * Companion Electron main 入口。
 *
 * 职责：启动 app、创建主窗口与托盘；挂载安全 bridge IPC。
 * 不拥有：pairing/identity 业务实现细节、OpenClaw、renderer 业务页实现；
 * PermissionGate 由 CompanionBridgeHost 持有。
 * 副作用：启动 Electron；加载本地 HTML 或开发期 Vite URL；注册白名单 IPC。
 */

import type { BrowserWindowConstructor } from "./create-window.js";
import { createMainWindow, resolveDefaultUiPaths } from "./create-window.js";
import type { TrayConstructor, TrayMenuBuilder } from "./create-tray.js";
import { createAppTray } from "./create-tray.js";
import { readOpenAtLogin, setOpenAtLogin, type LoginItemSettingsPort } from "../session/autostart.js";
import { trayConnectionToolTip } from "../session/reconnect-policy.js";
import { createCompanionBackendRuntime } from "../../backend/runtime.js";
import {
  MemoryIdentityPersistence,
  createDeviceIdentityStore,
} from "../../credentials/identity-store.js";
import { startCompanionProtocolServer } from "../../protocol-server/server.js";
import { registerBridgeIpc, type WebContentsLike } from "../../bridge/register-ipc.js";

/**
 * Electron 运行时最小面，便于测试替换。
 */
export interface ElectronRuntime {
  /** app 模块 */
  app: {
    whenReady(): Promise<void>;
    quit(): void;
    on(event: "window-all-closed", listener: () => void): void;
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
  };
  /** 可选 ipcMain；缺省则跳过 bridge 注册（纯壳单测） */
  ipcMain?: {
    handle(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown,
    ): void;
  };
  /** 可选开机启动适配；缺省用内存假实现 */
  loginItem?: LoginItemSettingsPort;
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
  };
}

/**
 * 可选 show / webContents，避免把 Electron 具体类型绑进窗口契约。
 */
interface WindowWithBridgeHooks {
  show?: () => void;
  webContents?: WebContentsLike;
}

/**
 * 在已注入的 Electron runtime 上启动桌面壳。
 *
 * @param electron 运行时
 * @param options 路径与开发 URL
 * @returns 启动完成（窗口已创建）
 */
export async function startCompanionDesktopShell(
  electron: ElectronRuntime,
  options: StartCompanionShellOptions = {},
): Promise<void> {
  await electron.app.whenReady();
  const defaults = options.metaUrl
    ? resolveDefaultUiPaths(options.metaUrl)
    : { preloadPath: "", rendererHtmlPath: "" };
  const preloadPath = options.preloadPath ?? defaults.preloadPath;
  const rendererHtmlPath = options.rendererHtmlPath ?? defaults.rendererHtmlPath;
  if (!preloadPath) {
    throw new Error("startCompanionDesktopShell 缺少 preloadPath");
  }
  if (!options.rendererUrl && !rendererHtmlPath) {
    throw new Error("startCompanionDesktopShell 缺少 rendererUrl 或 rendererHtmlPath");
  }

  let approvePairing: ((pairingId: string) => Promise<void>) | null = null;
  const backend = createCompanionBackendRuntime({
    onBridgeAction: async (action) => {
      if (action.type === "pairing.approve") {
        await approvePairing?.(action.pairingId);
      }
    },
  });
  let mainWindow: WindowWithBridgeHooks | null = null;

  if (electron.ipcMain) {
    registerBridgeIpc(
      electron.ipcMain,
      {
        subscribeSnapshot: backend.subscribeSnapshot,
        getSnapshot: backend.getSnapshot,
        submitAction: backend.applyBridgeAction,
        reportError: backend.getBridgeHost().reportError.bind(backend.getBridgeHost()),
        listPendingPermissionCards: backend.listPendingPermissionCards,
        getDiagnosticReport: backend.getDiagnosticReport,
      },
      () => mainWindow?.webContents ?? null,
    );
  }

  if (options.protocolServer?.enabled) {
    const protocolOptions = {
      ...(options.protocolServer.port !== undefined ? { port: options.protocolServer.port } : {}),
      backend,
      identityStore: createDeviceIdentityStore(new MemoryIdentityPersistence()),
      pairing: {
        desktopDeviceId: "lanxin-desktop",
        desktopDisplayName: "Lanxin Companion",
      },
    };
    const protocol = await startCompanionProtocolServer({
      ...protocolOptions,
    });
    approvePairing = protocol.approvePairing;
  }

  mainWindow = (await createMainWindow({
    BrowserWindow: electron.BrowserWindow,
    preloadPath,
    ...(options.rendererUrl
      ? { rendererUrl: options.rendererUrl }
      : { rendererHtmlPath }),
  })) as WindowWithBridgeHooks;

  const loginItem = electron.loginItem ?? createMemoryLoginItemPort();

  createAppTray({
    Tray: electron.Tray,
    Menu: electron.Menu,
    icon: electron.nativeImage.createEmpty(),
    toolTip: trayConnectionToolTip(false, false),
    disconnectHint: "与澜星电话的连接已断开。",
    openAtLogin: readOpenAtLogin(loginItem),
    onToggleOpenAtLogin: (next) => {
      setOpenAtLogin(loginItem, next);
    },
    onShowWindow: () => {
      mainWindow?.show?.();
    },
    onQuit: () => {
      electron.app.quit();
    },
  });

  electron.app.on("window-all-closed", () => {
    electron.app.quit();
  });
}

/**
 * 内存开机启动（无 Electron login item 时）。
 *
 * @returns port
 */
function createMemoryLoginItemPort(): LoginItemSettingsPort {
  let openAtLogin = false;
  return {
    isOpenAtLogin: () => openAtLogin,
    setOpenAtLogin: (value) => {
      openAtLogin = value;
    },
  };
}
