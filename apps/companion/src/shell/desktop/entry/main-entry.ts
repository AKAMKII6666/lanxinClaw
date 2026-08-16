/**
 * Electron 进程可执行入口（由 dist/main/main-entry.cjs 启动）。
 *
 * 职责：注入真实 electron API，解析 preload / renderer 路径并启动壳。
 * 不拥有：业务页、权限裁决细节、OpenClaw。
 * 副作用：启动 Electron 应用。
 */

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
} from "electron";
import path from "node:path";
import { startCompanionDesktopShell } from "../electron-main.js";

/** esbuild 打成 CJS 后由 Node 提供 __dirname（指向 dist/main） */
declare const __dirname: string;

const here = __dirname;
const rendererUrl = process.env.LANXIN_RENDERER_URL?.trim();
const protocolPort = Number(process.env.LANXIN_PROTOCOL_PORT ?? 0);

void startCompanionDesktopShell(
  {
    app,
    BrowserWindow: BrowserWindow as never,
    Tray: Tray as never,
    Menu,
    nativeImage,
    ipcMain,
    loginItem: {
      isOpenAtLogin: () => app.getLoginItemSettings().openAtLogin,
      setOpenAtLogin: (openAtLogin) => {
        app.setLoginItemSettings({ openAtLogin });
      },
    },
  },
  {
    preloadPath: path.join(here, "preload.cjs"),
    rendererHtmlPath: path.join(here, "..", "renderer", "index.html"),
    ...(rendererUrl ? { rendererUrl } : {}),
    protocolServer: {
      enabled: true,
      port: Number.isFinite(protocolPort) ? protocolPort : 0,
    },
  },
).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[companion-shell] FAILED ${message}\n`);
  app.quit();
});
