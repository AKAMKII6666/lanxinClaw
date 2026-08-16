/**
 * 桌面壳窗口/托盘契约的轻量单测（不启动真实 Electron）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAppTray } from "../../src/shell/desktop/create-tray.js";
import {
  createMainWindow,
  resolveDefaultUiPaths,
} from "../../src/shell/desktop/create-window.js";
import { lanxinPalette } from "../../src/ui/theme/lanxin-palette.js";

describe("companion desktop shell basics", () => {
  it("resolveDefaultUiPaths 指向 preload 与 html", () => {
    const paths = resolveDefaultUiPaths(import.meta.url);
    assert.match(paths.preloadPath.replace(/\\/g, "/"), /preload\.cjs$/);
    assert.match(paths.rendererHtmlPath.replace(/\\/g, "/"), /ui\/index\.html$/);
  });

  it("createMainWindow 使用 contextIsolation 且关闭 nodeIntegration", async () => {
    const calls: unknown[] = [];
    class FakeWindow {
      constructor(options: unknown) {
        calls.push(options);
      }
      async loadFile(_filePath: string): Promise<void> {
        return;
      }
      async loadURL(_url: string): Promise<void> {
        return;
      }
      on(_event: "closed", _listener: () => void): void {
        return;
      }
    }
    await createMainWindow({
      BrowserWindow: FakeWindow as never,
      preloadPath: "/tmp/preload.cjs",
      rendererHtmlPath: "/tmp/index.html",
    });
    const options = calls[0] as {
      webPreferences: { contextIsolation: boolean; nodeIntegration: boolean; sandbox: boolean };
    };
    assert.equal(options.webPreferences.contextIsolation, true);
    assert.equal(options.webPreferences.nodeIntegration, false);
    assert.equal(options.webPreferences.sandbox, true);
  });

  it("createMainWindow 优先 loadURL（开发期 Vite）", async () => {
    const loaded: string[] = [];
    class FakeWindow {
      constructor(_options: unknown) {
        return;
      }
      async loadFile(filePath: string): Promise<void> {
        loaded.push(`file:${filePath}`);
      }
      async loadURL(url: string): Promise<void> {
        loaded.push(`url:${url}`);
      }
      on(_event: "closed", _listener: () => void): void {
        return;
      }
    }
    await createMainWindow({
      BrowserWindow: FakeWindow as never,
      preloadPath: "/tmp/preload.cjs",
      rendererHtmlPath: "/tmp/index.html",
      rendererUrl: "http://127.0.0.1:5173/",
    });
    assert.deepEqual(loaded, ["url:http://127.0.0.1:5173/"]);
  });

  it("createAppTray 注册显示与退出", () => {
    const clicks: string[] = [];
    class FakeTray {
      tip = "";
      menu: unknown = null;
      setToolTip(text: string) {
        this.tip = text;
      }
      setContextMenu(menu: unknown) {
        this.menu = menu;
      }
    }
    const tray = createAppTray({
      Tray: FakeTray as never,
      Menu: {
        buildFromTemplate(items) {
          for (const item of items) {
            item.click?.();
          }
          return { items };
        },
      },
      icon: {},
      onShowWindow: () => clicks.push("show"),
      onQuit: () => clicks.push("quit"),
      toolTip: "澜星 Claw · 已断线",
      disconnectHint: "与澜星电话的连接已断开。",
      openAtLogin: false,
      onToggleOpenAtLogin: (next) => clicks.push(next ? "login-on" : "login-off"),
    });
    assert.equal((tray as FakeTray).tip, "澜星 Claw · 已断线");
    assert.deepEqual(clicks, ["show", "login-on", "quit"]);
  });

  it("主题色板对齐设计稿主色", () => {
    assert.equal(lanxinPalette.brand, "#2563EB");
    assert.equal(lanxinPalette.background, "#F6F7F9");
    assert.equal(lanxinPalette.danger, "#B91C1C");
  });
});
