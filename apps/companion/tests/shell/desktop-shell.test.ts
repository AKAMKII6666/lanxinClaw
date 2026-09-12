/**
 * 桌面壳窗口/托盘契约的轻量单测（不启动真实 Electron）。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createAppTray } from "../../src/shell/desktop/create-tray.js";
import {
  createMainWindow,
  resolveDefaultUiPaths,
} from "../../src/shell/desktop/create-window.js";
import { resolveOpenClawNodeBin } from "../../src/shell/desktop/node-bin.js";
import { resolveBundledOpenClawEntry } from "../../src/shell/desktop/openclaw-entry.js";
import { lanxinPalette } from "../../src/ui/theme/lanxin-palette.js";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/shell/desktop");

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
      iconsFromDir: desktopDir,
    });
    const options = calls[0] as {
      icon?: string;
      webPreferences: { contextIsolation: boolean; nodeIntegration: boolean; sandbox: boolean };
    };
    assert.equal(options.webPreferences.contextIsolation, true);
    assert.equal(options.webPreferences.nodeIntegration, false);
    assert.equal(options.webPreferences.sandbox, true);
    assert.match((options.icon ?? "").replace(/\\/g, "/"), /icons\/app\.png$/);
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
    });
    assert.equal((tray as FakeTray).tip, "澜星 Claw · 已断线");
    assert.deepEqual(clicks, ["show", "quit"]);
    const labels = ((tray as FakeTray).menu as { items: Array<{ label: string }> }).items.map((item) => item.label);
    assert.deepEqual(labels, ["显示面板", "退出澜星 Claw"]);
  });

  it("resolveBundledOpenClawEntry 自动发现随产品携带的 openclaw.mjs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-openclaw-entry-"));
    const entry = path.join(dir, "openclaw", "openclaw.mjs");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "", "utf8");
    assert.equal(resolveBundledOpenClawEntry({ resourcesPath: dir }), entry);
  });

  it("resolveBundledOpenClawEntry 开发态可从子目录向上发现仓库 vendor/openclaw", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-openclaw-dev-"));
    const entry = path.join(dir, "vendor", "openclaw", "openclaw.mjs");
    const child = path.join(dir, "apps", "companion");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(entry, "", "utf8");
    assert.equal(resolveBundledOpenClawEntry({ cwd: child }), entry);
  });

  it("resolveOpenClawNodeBin 开发态不把 Electron 当 Node", () => {
    const resolved = resolveOpenClawNodeBin({
      execPath: "C:\\Users\\dev\\node_modules\\electron\\dist\\electron.exe",
    });
    assert.equal(resolved, "node.exe");
  });

  it("resolveOpenClawNodeBin 优先使用打包资源里的 Node", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-node-bin-"));
    const nodeBin = path.join(dir, "node", process.platform === "win32" ? "node.exe" : "node");
    fs.mkdirSync(path.dirname(nodeBin), { recursive: true });
    fs.writeFileSync(nodeBin, "", "utf8");
    assert.equal(
      resolveOpenClawNodeBin({
        resourcesPath: dir,
        execPath: "C:\\app\\electron.exe",
      }),
      nodeBin,
    );
  });

  it("主题色板对齐设计稿主色", () => {
    assert.equal(lanxinPalette.brand, "#2563EB");
    assert.equal(lanxinPalette.background, "#F6F7F9");
    assert.equal(lanxinPalette.danger, "#B91C1C");
  });
});
