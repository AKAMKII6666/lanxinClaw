/**
 * 澜星控制面板色板常量。
 *
 * 职责：集中设计稿色值，供主题与无 MUI 环境单测复用。
 * 不拥有：MUI createTheme、页面布局。
 * 纯函数：仅常量。
 */

/**
 * 设计稿色板（见控制面板设计说明）。
 */
export const lanxinPalette = {
  background: "#F6F7F9",
  panel: "#FFFFFF",
  border: "#D8DEE8",
  textPrimary: "#18202A",
  textSecondary: "#5C6675",
  brand: "#2563EB",
  success: "#15803D",
  warning: "#B45309",
  danger: "#B91C1C",
  info: "#0369A1",
} as const;
