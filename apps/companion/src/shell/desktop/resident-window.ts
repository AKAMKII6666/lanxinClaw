/** 窗口驻留与托盘生命周期；业务资源关闭由 main 注入，窗口关闭只隐藏。 */
import path from "node:path";
import type { Logger } from "pino";
import type { WebContentsLike } from "../../bridge/register-ipc.js";
import type { LoginItemSettingsPort } from "../session/autostart.js";
import { trayConnectionToolTip } from "../session/reconnect-policy.js";
import { createAppTray } from "./create-tray.js";
import type { ElectronRuntime } from "./electron-runtime.js";
import { confirmQuit } from "./quit-confirm.js";
import { createQuitBarrier } from "./quit-barrier.js";
import { buildResidentTrayExtraItems } from "./resident-tray-menu.js";
import { createTrayIcon, resolveTrayIconPath } from "./tray-icon.js";
import type { ProtocolListenHost } from "../session/listen-host.js";

/** Electron 窗口的最小接口，供启动与 IPC 共享。 */
export interface WindowWithBridgeHooks {
  show?: () => void;
  hide?: () => void;
  on?: (event: "close", listener: (event?: { preventDefault(): void }) => void) => void;
  webContents?: WebContentsLike;
}

let retainedTray: unknown = null;

export function installResidentWindow(input: {
  electron: ElectronRuntime;
  window: WindowWithBridgeHooks;
  preloadPath: string;
  loginPort: LoginItemSettingsPort | null;
  listenHost: ProtocolListenHost;
  logDir: string;
  logger: Logger;
  setListenHost: (host: ProtocolListenHost) => void;
  shutdown: () => Promise<void>;
}): void {
  const { electron, window } = input;
  let allowWindowClose = false;
  electron.app.on("before-quit", createQuitBarrier({
    shutdown: input.shutdown,
    allowWindowClose: () => { allowWindowClose = true; },
    quit: () => electron.app.quit(),
    onError: (error) => input.logger.error({ error: String(error) }, "退出资源清理失败"),
  }));
  window.on?.("close", (event) => {
    if (allowWindowClose) return;
    event?.preventDefault();
    window.hide?.();
  });
  retainedTray = createAppTray({
    Tray: electron.Tray, Menu: electron.Menu,
    icon: createTrayIcon(electron.nativeImage, resolveTrayIconPath(path.dirname(input.preloadPath))),
    toolTip: trayConnectionToolTip(false, false),
    extraItems: buildResidentTrayExtraItems({
      loginPort: input.loginPort, listenHost: input.listenHost,
      onListenHostChange: input.setListenHost,
      openLogDir: () => { void electron.shell?.openPath(input.logDir); },
      logger: input.logger,
    }),
    onShowWindow: () => window.show?.(),
    onQuit: () => {
      void (async () => {
        if (!(await confirmQuit(electron.dialog))) return;
        electron.app.quit();
      })();
    },
  });
  electron.app.on("window-all-closed", () => {});
}
