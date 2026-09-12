/**
 * 桌面图标路径与 nativeImage 加载契约。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createTrayIcon,
  resolveAppIconPath,
  resolveDesktopIconsDir,
  resolveTrayIconPath,
} from "../../src/shell/desktop/tray-icon.js";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/shell/desktop");

describe("desktop icons", () => {
  it("icons 目录包含 app.ico 与 app.png", () => {
    const dir = resolveDesktopIconsDir(desktopDir);
    assert.equal(fs.existsSync(dir), true);
    assert.equal(fs.existsSync(resolveAppIconPath(desktopDir)), true);
    assert.equal(fs.existsSync(resolveTrayIconPath(desktopDir, "win32")), true);
  });

  it("Windows 托盘用 ico，其它平台用 png", () => {
    assert.match(resolveTrayIconPath(desktopDir, "win32").replace(/\\/g, "/"), /icons\/app\.ico$/);
    assert.match(resolveTrayIconPath(desktopDir, "linux").replace(/\\/g, "/"), /icons\/app\.png$/);
    assert.match(resolveTrayIconPath(desktopDir, "darwin").replace(/\\/g, "/"), /icons\/app\.png$/);
    assert.match(resolveAppIconPath(desktopDir).replace(/\\/g, "/"), /icons\/app\.png$/);
  });

  it("createTrayIcon 优先 createFromPath", () => {
    const loaded: string[] = [];
    const icon = createTrayIcon(
      {
        createEmpty: () => "empty",
        createFromPath: (iconPath) => {
          loaded.push(iconPath);
          return "loaded";
        },
      },
      resolveTrayIconPath(desktopDir, "win32"),
    );
    assert.equal(icon, "loaded");
    assert.equal(loaded.length, 1);
    assert.equal(fs.existsSync(loaded[0] ?? ""), true);
  });

  it("createTrayIcon 缺文件时退回空图", () => {
    const icon = createTrayIcon(
      {
        createEmpty: () => "empty",
        createFromPath: () => "loaded",
      },
      "/no/such/icon.ico",
    );
    assert.equal(icon, "empty");
  });
});
