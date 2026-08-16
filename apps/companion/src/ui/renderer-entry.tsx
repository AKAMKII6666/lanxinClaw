/**
 * React renderer 入口。
 *
 * 职责：挂载 ShellApp 到 #root。
 * 不拥有：Electron main；业务 IPC 由 preload bridge 提供。
 * 副作用：DOM 挂载；无桌面副作用 API。
 */

import { createRoot } from "react-dom/client";
import { ShellApp } from "./app/shell-app.js";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("缺少 #root，无法挂载 companion renderer");
}

createRoot(rootEl).render(<ShellApp />);
