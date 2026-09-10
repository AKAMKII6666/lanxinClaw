/**
 * Companion Electron main 入口。
 *
 * 职责：启动 app、创建主窗口与托盘；挂载安全 bridge IPC。
 * 不拥有：pairing/identity 业务实现细节、OpenClaw、renderer 业务页实现；
 * PermissionGate 由 CompanionBridgeHost 持有。
 * 副作用：启动 Electron；加载本地 HTML 或开发期 Vite URL；注册白名单 IPC。
 */

import { createMainWindow, resolveDefaultUiPaths } from "./create-window.js";
import { createAppTray } from "./create-tray.js";
import { createTrayIcon, resolveTrayIconPath } from "./tray-icon.js";
import { trayConnectionToolTip } from "../session/reconnect-policy.js";
import { OpenClawAdapter, createFileAdapterJobStore, createLocalSafeRuntimeClient } from "@lanxin-claw/openclaw-adapter";
import path from "node:path";
import { resolveOpenClawNodeBin } from "./node-bin.js";
import { resolveBundledOpenClawEntry } from "./openclaw-entry.js";
import { confirmQuit } from "./quit-confirm.js";
import type { ElectronRuntime, StartCompanionShellOptions } from "./electron-runtime.js";
import { createSecretsFromSafeStorage } from "./safe-storage-secrets.js";
import { buildResidentTrayExtraItems, showDesktopNotification } from "./resident-tray-menu.js";
import { buildGatewayDiagnosticsInput, buildGatewaySnapshotExtras } from "./panel-runtime-extras.js";
import { createCompanionBackendRuntime } from "../../backend/runtime.js";
import { createFileAuditStore } from "../../audit/file-store.js";
import { FileIdentityPersistence } from "../../credentials/persistence/file-identity-persistence.js";
import { EncryptedIdentityPersistence } from "../../credentials/persistence/encrypted-identity-persistence.js";
import { MemoryIdentityPersistence, createDeviceIdentityStore } from "../../credentials/identity-store.js";
import { GatewayRuntimeService } from "../../gateway-runtime/service.js";
import { JobDelegator } from "../../jobs/delegation/delegator.js";
import { createLoggerRegistry, resolveLogDir, type LoggerRegistry } from "../../logging/logger.js";
import { createGatewayRuntimeReadyProbe } from "../../onboarding/probe/runtime-probe.js";
import { createFileOnboardingStore, createMemoryOnboardingStore } from "../../onboarding/store/store.js";
import { OnboardingService } from "../../onboarding/service.js";
import { createFileBackendMirrorStore } from "../../state/mirror/backend-mirror.js";
import { createFilePermissionGateStore } from "../../permissions/gate/file-store.js";
import { PermissionGate } from "../../permissions/gate/permission-gate.js";
import { flushPendingContext } from "../../protocol-server/bridge-actions.js";
import { runShellBridgeAction } from "./bridge-outbound.js";
import { createDeviceRevokePairingHandler, createShellJobDelegator, restoreShellInFlightJobs, startShellLanDiscovery } from "./runtime-wiring.js";
import { createActivePairedPhoneIdsReader, createLanDiscoveryPairingRefresher } from "./pairing-discovery-refresh.js";
import type { LoginItemSettingsPort } from "../session/autostart.js";
import { startCompanionProtocolServer } from "../../protocol-server/server.js";
import { registerBridgeIpc, type WebContentsLike } from "../../bridge/register-ipc.js";
import { createOnboardingIpcPort } from "./onboarding-ipc-port.js";
import { createShellPrefsState } from "./shell-prefs-state.js";
import { createSetBrowserProxyHandler } from "./shell-browser-proxy-wiring.js";
import { isE2eAutoApproveEnabled, startE2eAutoApprove } from "./e2e-auto-approve.js";

export type { ElectronRuntime, StartCompanionShellOptions } from "./electron-runtime.js";

/**
 * 可选 show / webContents，避免把 Electron 具体类型绑进窗口契约。
 */
interface WindowWithBridgeHooks {
  show?: () => void;
  hide?: () => void;
  on?: (event: "close", listener: (event?: { preventDefault(): void }) => void) => void;
  webContents?: WebContentsLike;
}

let retainedTray: unknown = null;

/**
 * 在已注入的 Electron runtime 上启动桌面壳。
 *
 * @param electron 运行时
 * @param options 路径与开发 URL
 * @returns 启动完成（窗口已创建）
 */
export async function startCompanionDesktopShell(
  electron: ElectronRuntime,
  options: StartCompanionShellOptions = {},
): Promise<void> {
  await electron.app.whenReady();
  const userDataDir = electron.app.getPath?.("userData") ?? null;
  const logDir = options.logDir ?? resolveLogDir(process.env, userDataDir);
  const logRegistry: LoggerRegistry = await createLoggerRegistry({
    dir: logDir,
  });
  const shellLogger = logRegistry.getLogger("shell");
  shellLogger.info("companion shell 启动");
  const defaults = options.metaUrl
    ? resolveDefaultUiPaths(options.metaUrl)
    : { preloadPath: "", rendererHtmlPath: "" };
  const preloadPath = options.preloadPath ?? defaults.preloadPath;
  const rendererHtmlPath = options.rendererHtmlPath ?? defaults.rendererHtmlPath;
  if (!preloadPath) {
    throw new Error("startCompanionDesktopShell 缺少 preloadPath");
  }
  if (!options.rendererUrl && !rendererHtmlPath) {
    throw new Error("startCompanionDesktopShell 缺少 rendererUrl 或 rendererHtmlPath");
  }

  const desktopDeviceId = process.env.LANXIN_DESKTOP_DEVICE_ID?.trim() || "lanxin-desktop";
  const localWorkspaceRoot = process.env.LANXIN_OPENCLAW_WORKSPACE_ROOT?.trim() || null;
  const adapterJobStore = userDataDir ? createFileAdapterJobStore(path.join(userDataDir, "adapter-jobs.json")) : undefined;
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
  const gatewayStateDir =
    options.openclawStateDir ??
    (userDataDir ? path.join(userDataDir, "openclaw-runtime") : "");
  const workspace =
    options.workspace ??
    localWorkspaceRoot ??
    (gatewayStateDir ? path.join(gatewayStateDir, "workspace") : process.cwd());
  const adapter =
    options.adapter ??
    new OpenClawAdapter({
      runtime: createLocalSafeRuntimeClient({ workspaceRoot: workspace }),
      ...(adapterJobStore ? { store: adapterJobStore } : {}),
    });
  let approvePairing: ((pairingId: string) => Promise<void>) | null = null;
  let protocolHandle: Awaited<ReturnType<typeof startCompanionProtocolServer>> | null = null;
  let lanDiscoveryHandle: Awaited<ReturnType<typeof startShellLanDiscovery>> = null;
  let delegator: JobDelegator | null = null;
  let allowWindowClose = false;
  const diagnosticsState = {
    protocolServerReady: false,
    lanDiscoveryReady: false,
    recentServerErrorCode: null as string | null,
  };
  const secrets = createSecretsFromSafeStorage(electron.safeStorage);
  const onboardingStore =
    userDataDir && secrets.isAvailable()
      ? createFileOnboardingStore(path.join(userDataDir, "settings.json"), secrets)
      : createMemoryOnboardingStore(secrets);
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
  const shellPrefsState = createShellPrefsState({
    userDataDir,
    protocolHostOverride: options.protocolServer?.host,
  });
  let listenHost = shellPrefsState.getListenHost();
  const onboardingService = new OnboardingService({
    store: onboardingStore,
    logger: logRegistry.getLogger("shell"),
    runtimeReadyProbe: async () => {
      const stored = onboardingStore.load();
      if (!stored) {
        return { ok: false, code: "onboarding_config_missing", message: "缺少模型配置" };
      }
      if (!gatewayService) {
        return { ok: false, code: "gateway_runtime_unavailable", message: "未配置 OpenClaw 运行时" };
      }
      const prefs = shellPrefsState.getPrefs();
      const handle = await gatewayService.ensureStarted({
        provider: stored.provider,
        apiKey: stored.apiKey,
        endpoint: stored.endpoint,
        modelRef: stored.modelRef,
        workspace,
        enableWebSearch: false,
        enableBrowser: true,
        webSearchApiKey: stored.webSearchApiKey ?? "",
        browserProxyEnabled: prefs.browserProxyEnabled,
        browserProxyUrl: prefs.browserProxyUrl,
      });
      delegator?.setAdapter(handle.adapter);
      return createGatewayRuntimeReadyProbe({
        gatewayUrl: handle.url,
        token: handle.token,
      })();
    },
  });
  const onboardingIpc = createOnboardingIpcPort({
    service: onboardingService,
    stopGateway: () => {
      void gatewayService?.stop();
    },
  });
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
  const getActivePairedPhoneIds = createActivePairedPhoneIdsReader({ identityStore, desktopDeviceId });
  const refreshLanDiscoveryPairings = createLanDiscoveryPairingRefresher({
    getHandle: () => lanDiscoveryHandle,
    logger: shellLogger,
  });
  const backend = createCompanionBackendRuntime({
    permissionGate,
    desktopDeviceId,
    supervisionIntervalMs: 2_000,
    ...(userDataDir
      ? {
          auditStore: createFileAuditStore(path.join(userDataDir, "audit.json")),
          mirrorStore: createFileBackendMirrorStore(path.join(userDataDir, "backend-mirror.json")),
        }
      : {}),
    snapshotExtras: () =>
      buildGatewaySnapshotExtras(
        gatewayService,
        onboardingService.getStatus() === "ready",
        secrets.isAvailable(),
      ),
    diagnosticsInput: () =>
      buildGatewayDiagnosticsInput({
        protocolServerReady: diagnosticsState.protocolServerReady,
        lanDiscoveryReady: diagnosticsState.lanDiscoveryReady,
        recentServerErrorCode: diagnosticsState.recentServerErrorCode,
        gateway: gatewayService,
        secretsAvailable: secrets.isAvailable(),
        browserProxyEnabled: shellPrefsState.getPrefs().browserProxyEnabled,
        browserProxyUrl: shellPrefsState.getPrefs().browserProxyUrl,
      }),
    onDesktopNotify: (title, body) => {
      shellLogger.info({ title, body }, "桌面提醒");
      showDesktopNotification(electron.Notification, title, body);
    },
    onProtocolBroadcast: (envelope) => {
      protocolHandle?.broadcast(envelope);
    },
    onDeviceRevokePairing: createDeviceRevokePairingHandler({
      identityStore,
      getProtocolHandle: () => protocolHandle,
      getPairingId: () => backend.getState().connection.pairingId ?? null,
      getDelegator: () => delegator,
      getJobAffairId: (jobId) => backend.getState().jobs.get(jobId)?.affairId ?? "",
      onPairingChanged: refreshLanDiscoveryPairings,
    }),
    onBridgeAction: (action, result) =>
      runShellBridgeAction(
        {
          desktopDeviceId,
          backend,
          getDelegator: () => delegator,
          broadcast: (envelope) => protocolHandle?.broadcast(envelope),
          approvePairing,
          openLogDir: () => {
            void electron.shell?.openPath(logDir);
          },
          relaunchCompanion: () => {
            electron.app.relaunch?.();
            electron.app.quit();
          },
          setBrowserProxy: createSetBrowserProxyHandler({
            getShellPrefs: () => shellPrefsState.getPrefs(),
            persistShellPrefs: shellPrefsState.persist,
            getOnboardingConfig: () => onboardingStore.load(),
            isOnboardingReady: () => onboardingService.getStatus() === "ready",
            gatewayService,
            workspace,
            getDelegator: () => delegator,
            hasRunningJobs: () => {
              for (const job of backend.getState().jobs.values()) {
                if (job.status === "running" || job.status === "queued") {
                  return true;
                }
              }
              return false;
            },
          }),
          logger: shellLogger,
        },
        action,
        result,
      ),
  });
  delegator = createShellJobDelegator({
    adapter,
    backend,
    desktopDeviceId,
    workspace,
    applyProtocolEnvelope: (envelope) => backend.applyProtocolEnvelope(envelope),
    sendEnvelope: (envelope) => {
      protocolHandle?.sendEnvelope(envelope);
    },
    pollIntervalMs: options.jobPollIntervalMs ?? Number(process.env.LANXIN_JOB_POLL_MS ?? 2_000),
    logRegistry,
  });
  let mainWindow: WindowWithBridgeHooks | null = null;

  if (electron.ipcMain) {
    registerBridgeIpc(
      electron.ipcMain,
      {
        subscribeSnapshot: backend.subscribeSnapshot,
        getSnapshot: backend.getSnapshot,
        submitAction: backend.applyBridgeAction,
        reportError: backend.getBridgeHost().reportError.bind(backend.getBridgeHost()),
        listPendingPermissionCards: backend.listPendingPermissionCards,
        getDiagnosticReport: backend.getDiagnosticReport,
      },
      () => mainWindow?.webContents ?? null,
      (entry) => {
        const logger = logRegistry.getLogger("ui");
        logger[entry.level]({ ...(entry.meta !== undefined ? { meta: entry.meta } : {}) }, entry.message);
      },
      onboardingIpc,
    );
  }

  if (options.protocolServer?.enabled) {
    const protocolOptions = {
      ...(options.protocolServer.port !== undefined ? { port: options.protocolServer.port } : {}),
      host: options.protocolServer.host ?? listenHost,
      backend,
      identityStore,
      pairing: {
        desktopDeviceId,
        desktopDisplayName: "Lanxin Companion",
      },
    };
    protocolHandle = await startCompanionProtocolServer({
      ...protocolOptions,
      logger: logRegistry.getLogger("protocol"),
      ...(gatewayService
        ? { getOpenClawToolCapabilities: () => gatewayService.getOpenClawToolCapabilities() }
        : {}),
      onJobCancel: (input) => (delegator ? delegator.cancelJob(input) : Promise.resolve()),
      onSessionAccepted: () => {
        flushPendingContext({
          getParty: () => {
            const phoneDeviceId = backend.getState().connection.phoneDeviceId;
            return phoneDeviceId ? { desktopDeviceId, phoneDeviceId } : null;
          },
          isSessionAuthenticated: () => backend.getState().connection.sessionAuthenticated,
          hasActiveCall: () => false,
          getAffair: (affairId) => backend.getState().affairs.get(affairId),
          broadcast: (envelope) => protocolHandle?.broadcast(envelope),
          pendingContext: backend.getPendingContext(),
          recordActionDelivery: (delivery) => backend.recordBridgeActionDelivery(delivery),
        });
      },
    });
    diagnosticsState.protocolServerReady = true;
    const approvePairingWithDiscoveryRefresh = protocolHandle.approvePairing;
    approvePairing = async (pairingId) => {
      await approvePairingWithDiscoveryRefresh(pairingId);
      await refreshLanDiscoveryPairings();
    };

    restoreShellInFlightJobs(delegator, backend, adapter);

    lanDiscoveryHandle = await startShellLanDiscovery({
      enabled: options.discovery?.enabled !== false,
      protocolPort: protocolHandle.port,
      desktopDeviceId,
      getPairedPhoneIds: getActivePairedPhoneIds,
      logger: logRegistry.getLogger("discovery"),
      onResult: (result) => {
        diagnosticsState.lanDiscoveryReady = result.lanDiscoveryReady;
        if (result.recentServerErrorCode) {
          diagnosticsState.recentServerErrorCode = result.recentServerErrorCode;
        }
      },
    });

    if (isE2eAutoApproveEnabled()) {
      const stopE2e = startE2eAutoApprove({
        getSnapshot: () => backend.getSnapshot(),
        getPendingPairingId: () => protocolHandle?.getPendingPairingId() ?? null,
        listPendingPermissionCards: () => backend.listPendingPermissionCards(),
        applyBridgeAction: (action) => backend.applyBridgeAction(action),
        bootstrapRuntime: () => onboardingIpc.bootstrapRuntime(),
        logger: shellLogger,
      });
      electron.app.on("will-quit", () => {
        stopE2e();
      });
      shellLogger.info(
        { event: "e2e.auto_approve_armed", protocolPort: protocolHandle.port },
        "LANXIN_E2E_AUTO_APPROVE 已启用",
      );
    }
  }

  mainWindow = (await createMainWindow({
    BrowserWindow: electron.BrowserWindow,
    preloadPath,
    ...(options.rendererUrl
      ? { rendererUrl: options.rendererUrl }
      : { rendererHtmlPath }),
  })) as WindowWithBridgeHooks;
  mainWindow.on?.("close", (event) => {
    if (allowWindowClose) {
      return;
    }
    event?.preventDefault();
    mainWindow?.hide?.();
  });

  retainedTray = createAppTray({
    Tray: electron.Tray,
    Menu: electron.Menu,
    icon: createTrayIcon(electron.nativeImage, resolveTrayIconPath(path.dirname(preloadPath))),
    toolTip: trayConnectionToolTip(false, false),
    extraItems: buildResidentTrayExtraItems({
      loginPort,
      listenHost,
      onListenHostChange: (next) => {
        shellPrefsState.setListenHost(next);
        listenHost = next;
      },
      openLogDir: () => {
        void electron.shell?.openPath(logDir);
      },
      logger: shellLogger,
    }),
    onShowWindow: () => {
      mainWindow?.show?.();
    },
    onQuit: () => {
      void (async () => {
        if (!(await confirmQuit(electron.dialog))) {
          return;
        }
        allowWindowClose = true;
        backend.stopSupervision();
        delegator?.stop();
        await lanDiscoveryHandle?.stop();
        await protocolHandle?.close();
        await gatewayService?.stop();
        electron.app.quit();
      })();
    },
  });

  electron.app.on("window-all-closed", () => {
    return;
  });
}
