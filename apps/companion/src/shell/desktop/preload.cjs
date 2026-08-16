/**
 * Electron preload：仅暴露白名单 bridge API。
 *
 * 职责：经 contextBridge 向 renderer 提供 getSnapshot / 订阅 / submitAction / reportError /
 * listPendingPermissionCards / getDiagnosticReport。
 * 不拥有：文件系统、命令、凭据明文、权限裁决权威、任意 Node require。
 * 副作用：向 window.lanxinCompanionBridge 挂只读安全面。
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = {
  getSnapshot: "lanxin:bridge:getSnapshot",
  snapshotUpdated: "lanxin:bridge:snapshotUpdated",
  submitAction: "lanxin:bridge:submitAction",
  reportError: "lanxin:bridge:reportError",
  listPendingPermissions: "lanxin:bridge:listPendingPermissions",
  getDiagnosticReport: "lanxin:bridge:getDiagnosticReport",
};

contextBridge.exposeInMainWorld("lanxinCompanionBridge", {
  getSnapshot() {
    return ipcRenderer.invoke(CHANNELS.getSnapshot);
  },
  subscribeSnapshot(listener) {
    if (typeof listener !== "function") {
      return () => undefined;
    }
    const handler = (_event, snapshot) => {
      listener(snapshot);
    };
    ipcRenderer.on(CHANNELS.snapshotUpdated, handler);
    return () => {
      ipcRenderer.removeListener(CHANNELS.snapshotUpdated, handler);
    };
  },
  submitAction(action) {
    return ipcRenderer.invoke(CHANNELS.submitAction, action);
  },
  reportError(report) {
    return ipcRenderer.invoke(CHANNELS.reportError, report);
  },
  listPendingPermissionCards() {
    return ipcRenderer.invoke(CHANNELS.listPendingPermissions);
  },
  getDiagnosticReport() {
    return ipcRenderer.invoke(CHANNELS.getDiagnosticReport);
  },
});
