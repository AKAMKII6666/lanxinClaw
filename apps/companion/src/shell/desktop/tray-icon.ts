/**
 * 桌面托盘与窗口图标。
 *
 * 职责：按调用方给出的目录解析随包 `icons/`，并用 nativeImage 加载。
 * 不拥有：托盘菜单、窗口生命周期、安装包图标打包配置。
 * 约束：不使用 import.meta.url；main 打成 CJS 后该值会空，须由入口传入目录。
 */

import { existsSync } from "node:fs";
import path from "node:path";

/** 支持的 nativeImage 最小面 */
export interface TrayIconNativeImage {
  createEmpty(): unknown;
  createFromPath?(iconPath: string): unknown;
}

/**
 * 图标文件所在目录。
 *
 * @param fromDir 含 `icons/` 的目录（源码为 `desktop/`，打包后为 `dist/main`）
 * @returns 绝对目录
 */
export function resolveDesktopIconsDir(fromDir: string): string {
  return path.join(fromDir, "icons");
}

/**
 * 托盘图标：Windows 用多尺寸 ico，其它平台用 PNG。
 *
 * @param fromDir 含 `icons/` 的目录
 * @param platform 目标平台；缺省当前进程
 * @returns 图标绝对路径
 */
export function resolveTrayIconPath(
  fromDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const dir = resolveDesktopIconsDir(fromDir);
  const ico = path.join(dir, "app.ico");
  const png = path.join(dir, "app.png");
  if (platform === "win32" && existsSync(ico)) {
    return ico;
  }
  return existsSync(png) ? png : ico;
}

/**
 * 窗口 / 任务栏图标：优先较高分辨率 PNG。
 *
 * @param fromDir 含 `icons/` 的目录
 * @returns 图标绝对路径
 */
export function resolveAppIconPath(fromDir: string): string {
  const dir = resolveDesktopIconsDir(fromDir);
  const png = path.join(dir, "app.png");
  const ico = path.join(dir, "app.ico");
  return existsSync(png) ? png : ico;
}

/**
 * 创建托盘图标。
 *
 * @param nativeImage Electron 的 nativeImage 工厂
 * @param iconPath 已解析的图标路径；缺省或文件不存在时退回空图
 * @returns 图标对象
 */
export function createTrayIcon(nativeImage: TrayIconNativeImage, iconPath?: string): unknown {
  if (iconPath && existsSync(iconPath) && nativeImage.createFromPath) {
    return nativeImage.createFromPath(iconPath);
  }
  return nativeImage.createEmpty();
}
