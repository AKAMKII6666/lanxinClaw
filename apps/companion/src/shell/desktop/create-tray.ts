/**
 * Electron 系统托盘基础。
 *
 * 职责：创建托盘图标与“显示面板 / 退出澜星 Claw”菜单。
 * 不拥有：自动重连网络实现、配对、权限。
 * 副作用：注册原生托盘；回调由 main 注入。
 */

/**
 * 托盘菜单项契约。
 */
export interface TrayMenuItemSpec {
  /** 菜单文案 */
  label: string;
  /** 点击回调 */
  click?: () => void;
  /** 勾选态；可空 */
  checked?: boolean;
  /** 是否 checkbox 类型 */
  type?: "normal" | "checkbox" | "separator";
}

/**
 * Menu 构建契约。
 */
export interface TrayMenuBuilder {
  /**
   * @param items 菜单项
   * @returns 原生菜单对象
   */
  buildFromTemplate(items: TrayMenuItemSpec[]): unknown;
  /** 移除或替换应用级菜单；正式版用于隐藏 Electron 默认菜单。 */
  setApplicationMenu?(menu: unknown | null): void;
}

/**
 * Tray 实例契约。
 */
export interface TrayLike {
  /** 绑定右键/点击菜单 */
  setContextMenu(menu: unknown): void;
  /** 悬停提示 */
  setToolTip(text: string): void;
}

/**
 * Tray 构造器契约。
 */
export type TrayConstructor = new (icon: unknown) => TrayLike;

/**
 * 创建托盘的选项。
 */
export interface CreateAppTrayOptions {
  /** Tray 构造器 */
  Tray: TrayConstructor;
  /** 菜单构建器 */
  Menu: TrayMenuBuilder;
  /** 托盘图标（NativeImage 或路径，由调用方准备） */
  icon: unknown;
  /** 显示主窗口 */
  onShowWindow: () => void;
  /** 退出应用 */
  onQuit: () => void;
  /** 悬停提示；缺省「澜星 Claw」 */
  toolTip?: string;
  /** 附加菜单项（开机启动、局域网监听等） */
  extraItems?: TrayMenuItemSpec[];
}

/**
 * 创建基础托盘：只提供显示面板和退出。
 *
 * @param options 依赖与回调
 * @returns 托盘实例
 */
export function createAppTray(options: CreateAppTrayOptions): TrayLike {
  const tray = new options.Tray(options.icon);
  tray.setToolTip(options.toolTip ?? "澜星 Claw");
  const extras = options.extraItems ?? [];
  const items: TrayMenuItemSpec[] = [
    { label: "显示面板", click: options.onShowWindow },
    ...extras,
    ...(extras.length > 0 ? [{ type: "separator" as const, label: "" }] : []),
    { label: "退出澜星 Claw", click: options.onQuit },
  ];
  tray.setContextMenu(options.Menu.buildFromTemplate(items));
  return tray;
}
