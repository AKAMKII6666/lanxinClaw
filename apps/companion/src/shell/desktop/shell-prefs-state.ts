/**
 * shell-settings.json 加载与可变偏好。
 *
 * 职责：构造 JsonFilePersistence、normalize、提供 persist 闭包。
 * 不拥有：Gateway、托盘、Electron。
 * 副作用：读写 shell-settings.json。
 */

import path from "node:path";
import { JsonFilePersistence } from "../../persistence/json-file.js";
import { parseProtocolListenHost, type ProtocolListenHost } from "../session/listen-host.js";
import {
  DEFAULT_BROWSER_PROXY_URL,
  normalizeShellSettings,
  type CompanionShellSettings,
} from "./shell-settings.js";

/** shell 偏好可变状态 */
export interface ShellPrefsState {
  /** 读取当前偏好 */
  getPrefs: () => CompanionShellSettings;
  /** 持久化并更新内存 */
  persist: (next: CompanionShellSettings) => void;
  /** 当前协议监听地址 */
  getListenHost: () => ProtocolListenHost;
  /** 更新监听地址并落盘 */
  setListenHost: (next: ProtocolListenHost) => void;
}

/**
 * @param input 用户数据目录与可选协议 host 覆盖
 * @returns 可变偏好与持久化
 */
export function createShellPrefsState(input: {
  userDataDir: string | null;
  protocolHostOverride?: string | null;
}): ShellPrefsState {
  const defaultListenHost = parseProtocolListenHost(
    input.protocolHostOverride ?? process.env.LANXIN_PROTOCOL_HOST,
  );
  const shellSettings = input.userDataDir
    ? new JsonFilePersistence<CompanionShellSettings>(
        path.join(input.userDataDir, "shell-settings.json"),
        {
          listenHost: defaultListenHost,
          browserProxyEnabled: true,
          browserProxyUrl: DEFAULT_BROWSER_PROXY_URL,
        },
      )
    : null;
  let shellPrefs = normalizeShellSettings(shellSettings?.load(), defaultListenHost);
  const persist = (next: CompanionShellSettings): void => {
    shellPrefs = next;
    shellSettings?.save(next);
  };
  return {
    getPrefs: () => shellPrefs,
    persist,
    getListenHost: () => shellPrefs.listenHost,
    setListenHost: (next) => {
      persist({ ...shellPrefs, listenHost: next });
    },
  };
}
