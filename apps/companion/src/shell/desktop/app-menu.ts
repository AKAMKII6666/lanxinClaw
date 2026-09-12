/**
 * Electron 应用级菜单控制。
 */

import type { ElectronRuntime } from "./electron-runtime.js";

/**
 * 打包态移除 Electron 默认应用菜单，避免 Windows 顶部出现 File/Edit/View 等调试菜单。
 */
export function suppressPackagedApplicationMenu(
  electron: Pick<ElectronRuntime, "app" | "Menu">,
): void {
  if (electron.app.isPackaged === true) {
    electron.Menu.setApplicationMenu?.(null);
  }
}
