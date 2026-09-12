/** 启动资源装配：隔离运行目录、持久化与运行时；不创建窗口或发起 job。 */
import { OpenClawAdapter,createFileAdapterJobStore,createLocalSafeRuntimeClient } from "@lanxin-claw/openclaw-adapter";
import path from "node:path";
import { MemoryIdentityPersistence,createDeviceIdentityStore } from "../../../credentials/identity-store.js";
import { EncryptedIdentityPersistence } from "../../../credentials/persistence/encrypted-identity-persistence.js";
import { FileIdentityPersistence } from "../../../credentials/persistence/file-identity-persistence.js";
import { GatewayRuntimeService } from "../../../gateway-runtime/service.js";
import { type LoggerRegistry } from "../../../logging/logger.js";
import { createFileOnboardingStore,createMemoryOnboardingStore } from "../../../onboarding/store/store.js";
import { createFilePermissionGateStore } from "../../../permissions/gate/file-store.js";
import { PermissionGate } from "../../../permissions/gate/permission-gate.js";
import type { LoginItemSettingsPort } from "../../session/autostart.js";
import type { ElectronRuntime,StartCompanionShellOptions } from "../electron-runtime.js";
import { resolveOpenClawNodeBin } from "../node-bin.js";
import { resolveBundledOpenClawEntry } from "../openclaw-entry.js";
import { createSecretsFromSafeStorage } from "../safe-storage-secrets.js";

export function createShellRuntimeResources(electron: ElectronRuntime, options: StartCompanionShellOptions, userDataDir: string | null, logRegistry: LoggerRegistry) {
  const desktopDeviceId = process.env.LANXIN_DESKTOP_DEVICE_ID?.trim() || "lanxin-desktop";
  const adapterJobStore = userDataDir ? createFileAdapterJobStore(path.join(userDataDir, "adapter-jobs.json")) : undefined;
  const { openclawEntry, openclawNodeBin } = resolveInstalledRuntime(electron, options);
  const { gatewayStateDir, workspace } = resolveWorkspace(options, userDataDir);
  const adapter =
    options.adapter ??
    new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: workspace }),
      ...(adapterJobStore ? { store: adapterJobStore } : {}),
    });
  const gatewayService =
    options.gatewayService ??
    (openclawEntry && gatewayStateDir
      ? new GatewayRuntimeService({
          openclawEntry,
          nodeBin: openclawNodeBin,
          stateDir: gatewayStateDir,
          logFile: path.join(gatewayStateDir, "logs", "openclaw-runtime.log"),
          logger: logRegistry.getLogger("runtime"),
          ...(adapterJobStore ? { adapterJobStore } : {}),
        })
      : null);
  return { desktopDeviceId, workspace, adapter, gatewayService, ...createPersistence(electron, userDataDir) };
}

function resolveInstalledRuntime(electron: ElectronRuntime, options: StartCompanionShellOptions) {
  const entryInput = {
    appPath: electron.app.getAppPath?.() ?? null,
    resourcesPath: (process as { resourcesPath?: string }).resourcesPath ?? null,
    cwd: process.cwd(),
    ...(options.openclawEntry !== undefined ? { explicit: options.openclawEntry } : {}),
    ...(process.env.LANXIN_OPENCLAW_ENTRY !== undefined ? { envEntry: process.env.LANXIN_OPENCLAW_ENTRY } : {}),
  };
  const openclawEntry = resolveBundledOpenClawEntry(entryInput);
  const openclawNodeBin = resolveOpenClawNodeBin({
    resourcesPath: (process as { resourcesPath?: string }).resourcesPath ?? null,
    execPath: process.execPath,
    ...(process.env.LANXIN_OPENCLAW_NODE_BIN !== undefined
      ? { envNodeBin: process.env.LANXIN_OPENCLAW_NODE_BIN }
      : {}),
  });
  return { openclawEntry, openclawNodeBin };
}

function resolveWorkspace(options: StartCompanionShellOptions, userDataDir: string | null) {
  const localWorkspaceRoot = process.env.LANXIN_OPENCLAW_WORKSPACE_ROOT?.trim() || null;
  const gatewayStateDir =
    options.openclawStateDir ??
    (userDataDir ? path.join(userDataDir, "openclaw-runtime") : "");
  const workspace =
    options.workspace ??
    localWorkspaceRoot ??
    (gatewayStateDir ? path.join(gatewayStateDir, "workspace") : process.cwd());
  return { gatewayStateDir, workspace };
}

function createPersistence(electron: ElectronRuntime, userDataDir: string | null) {
  const secrets = createSecretsFromSafeStorage(electron.safeStorage);
  const onboardingStore =
    userDataDir && secrets.isAvailable()
      ? createFileOnboardingStore(path.join(userDataDir, "settings.json"), secrets)
      : createMemoryOnboardingStore(secrets);
  const permissionGate = new PermissionGate();
  if (userDataDir) {
    const permissionStore = createFilePermissionGateStore(path.join(userDataDir, "permission-grants.json"));
    permissionGate.hydrate(permissionStore.load());
    permissionGate.setOnChange(() => {
      permissionStore.save({ schemaVersion: 1, ...permissionGate.dump() });
    });
  }
  const loginPort: LoginItemSettingsPort | null =
    electron.app.getLoginItemSettings && electron.app.setLoginItemSettings
      ? {
          isOpenAtLogin: () => electron.app.getLoginItemSettings?.().openAtLogin ?? false,
          setOpenAtLogin: (enabled) => electron.app.setLoginItemSettings?.({ openAtLogin: enabled }),
        }
      : null;
  const identityStore = createDeviceIdentityStore(
    userDataDir && secrets.isAvailable()
      ? new EncryptedIdentityPersistence(
          new FileIdentityPersistence(path.join(userDataDir, "identity.json")),
          secrets,
        )
      : new MemoryIdentityPersistence(),
  );
  return { secrets, onboardingStore, permissionGate, loginPort, identityStore };
}
