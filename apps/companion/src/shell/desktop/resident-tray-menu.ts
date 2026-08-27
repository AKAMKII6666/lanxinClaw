/**
 * 常驻托盘附加菜单：开机启动、局域网监听、打开日志。
 *
 * 职责：构造 extraItems；不创建 Tray 实例。
 * 不拥有：协议 listen、Electron app 生命周期。
 * 副作用：经回调改 login item 与 shell-settings。
 */

import type { Logger } from "pino";
import type { TrayMenuItemSpec } from "./create-tray.js";
import { setOpenAtLogin, type LoginItemSettingsPort } from "../session/autostart.js";
import type { ProtocolListenHost } from "../session/listen-host.js";

/**
 * 构造常驻托盘附加项。
 *
 * @param input 当前偏好与回调
 * @returns extraItems
 */
export function buildResidentTrayExtraItems(input: {
  loginPort: LoginItemSettingsPort | null;
  listenHost: ProtocolListenHost;
  onListenHostChange: (next: ProtocolListenHost) => void;
  openLogDir: () => void;
  logger: Logger;
}): TrayMenuItemSpec[] {
  return [
    {
      label: "开机启动",
      type: "checkbox",
      checked: input.loginPort ? input.loginPort.isOpenAtLogin() : false,
      click: () => {
        if (!input.loginPort) {
          return;
        }
        setOpenAtLogin(input.loginPort, !input.loginPort.isOpenAtLogin());
      },
    },
    {
      label: input.listenHost === "0.0.0.0" ? "监听局域网（已开）" : "监听局域网（下次启动生效）",
      type: "checkbox",
      checked: input.listenHost === "0.0.0.0",
      click: () => {
        const next = input.listenHost === "0.0.0.0" ? "127.0.0.1" : "0.0.0.0";
        input.onListenHostChange(next);
        input.logger.info({ listenHost: next }, "协议监听地址已保存，需重启 companion 生效");
      },
    },
    {
      label: "打开日志目录",
      click: input.openLogDir,
    },
  ];
}

/**
 * 弹出桌面通知；构造器不可用时静默。
 *
 * @param NotificationCtor Electron Notification；可空
 * @param title 标题
 * @param body 正文
 */
export function showDesktopNotification(
  NotificationCtor: ElectronNotificationCtor | undefined,
  title: string,
  body: string,
): void {
  if (!NotificationCtor) {
    return;
  }
  if (typeof NotificationCtor.isSupported === "function" && !NotificationCtor.isSupported()) {
    return;
  }
  new NotificationCtor({ title, body }).show();
}

/** Notification 构造器形状 */
export type ElectronNotificationCtor = (new (options: { title: string; body: string }) => {
  show(): void;
}) & {
  isSupported?: () => boolean;
};
