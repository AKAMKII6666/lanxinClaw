/**
 * 开机启动偏好（Electron login item 抽象）。
 *
 * 职责：读写“随系统启动”开关的契约，供 main 注入真实 app.setLoginItemSettings。
 * 不拥有：托盘菜单 UI、配对、权限。
 * 纯函数：策略与结果映射；真实 Electron 调用由适配器执行。
 */

/**
 * 登录项设置读写契约。
 */
export interface LoginItemSettingsPort {
  /**
   * @returns 当前是否开机启动
   */
  isOpenAtLogin(): boolean;
  /**
   * @param openAtLogin 是否开机启动
   */
  setOpenAtLogin(openAtLogin: boolean): void;
}

/**
 * 读取开机启动偏好。
 *
 * @param port 适配器
 * @returns 是否启用
 */
export function readOpenAtLogin(port: LoginItemSettingsPort): boolean {
  return port.isOpenAtLogin();
}

/**
 * 设置开机启动偏好。
 *
 * @param port 适配器
 * @param enabled 是否启用
 * @returns 设置后的值
 */
export function setOpenAtLogin(port: LoginItemSettingsPort, enabled: boolean): boolean {
  port.setOpenAtLogin(enabled);
  return port.isOpenAtLogin();
}
