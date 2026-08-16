/**
 * 澜星 Claw 控制面板 MUI 主题。
 *
 * 职责：按控制面板设计稿色板生成 createTheme。
 * 不拥有：页面布局、业务状态、Electron 生命周期。
 * 纯函数：调用 MUI createTheme，无磁盘/网络副作用。
 */

import { createTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import { lanxinPalette } from "./lanxin-palette.js";

/**
 * 创建澜星工作台主题：安静、可信，避免营销式紫渐变。
 *
 * @returns MUI Theme
 */
export function createLanxinTheme(): Theme {
  return createTheme({
    palette: {
      mode: "light",
      primary: { main: lanxinPalette.brand },
      success: { main: lanxinPalette.success },
      warning: { main: lanxinPalette.warning },
      error: { main: lanxinPalette.danger },
      info: { main: lanxinPalette.info },
      background: {
        default: lanxinPalette.background,
        paper: lanxinPalette.panel,
      },
      text: {
        primary: lanxinPalette.textPrimary,
        secondary: lanxinPalette.textSecondary,
      },
      divider: lanxinPalette.border,
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      fontFamily: `"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`,
    },
  });
}
