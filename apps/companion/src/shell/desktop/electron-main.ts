import { createShellOnboarding } from "./bootstrap/onboarding.js";
import { createShellRuntimeResources } from "./bootstrap/runtime-resources.js";
import { installResidentWindow,type WindowWithBridgeHooks } from "./resident-window.js";
/**
 * Companion Electron main 入口。
 *
 * 职责：启动 app、创建主窗口与托盘；挂载安全 bridge IPC。
 * 不拥有：pairing/identity 业务实现细节、OpenClaw、renderer 业务页实现；
 * PermissionGate 由 CompanionBridgeHost 持有。
 * 副作用：启动 Electron；加载本地 HTML 或开发期 Vite URL；注册白名单 IPC。
 */

import path from "node:path";
import { createFileAuditStore } from "../../audit/file-store.js";
import { createCompanionBackendRuntime } from "../../backend/runtime.js";
import { registerBridgeIpc } from "../../bridge/register-ipc.js";
import { JobDelegator } from "../../jobs/delegation/delegator.js";
import { createLoggerRegistry,resolveLogDir,type LoggerRegistry } from "../../logging/logger.js";
import { flushPendingContext } from "../../protocol-server/bridge-actions.js";
import { startCompanionProtocolServer } from "../../protocol-server/server.js";
import { createFileBackendMirrorStore } from "../../state/mirror/backend-mirror.js";
import { suppressPackagedApplicationMenu } from "./app-menu.js";
import { runShellBridgeAction } from "./bridge-outbound.js";
import { createMainWindow,resolveDefaultUiPaths } from "./create-window.js";
import { isE2eAutoApproveEnabled,startE2eAutoApprove } from "./e2e-auto-approve.js";
import type { ElectronRuntime,StartCompanionShellOptions } from "./electron-runtime.js";
import { createActivePairedPhoneIdsReader,createLanDiscoveryPairingRefresher } from "./pairing-discovery-refresh.js";
import { buildGatewayDiagnosticsInput,buildGatewaySnapshotExtras } from "./panel-runtime-extras.js";
import { showDesktopNotification } from "./resident-tray-menu.js";
import { createDeviceRevokePairingHandler,createShellJobDelegator,createShellJobRecovery,startShellLanDiscovery } from "./runtime-wiring.js";
import { createSetBrowserProxyHandler } from "./shell-browser-proxy-wiring.js";
import { createShellPrefsState } from "./shell-prefs-state.js";

export type { ElectronRuntime,StartCompanionShellOptions } from "./electron-runtime.js";

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
  suppressPackagedApplicationMenu(electron);
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

  const { desktopDeviceId, workspace, adapter, secrets, onboardingStore, gatewayService, permissionGate, loginPort, identityStore } =
    createShellRuntimeResources(electron, options, userDataDir, logRegistry);
  let approvePairing: ((pairingId: string) => Promise<void>) | null = null;
  let protocolHandle: Awaited<ReturnType<typeof startCompanionProtocolServer>> | null = null;
  let lanDiscoveryHandle: Awaited<ReturnType<typeof startShellLanDiscovery>> = null;
  let delegator: JobDelegator | null = null;
  const diagnosticsState = {
    protocolServerReady: false,
    lanDiscoveryReady: false,
    recentServerErrorCode: null as string | null,
  };
  const shellPrefsState = createShellPrefsState({
    userDataDir,
    ...(options.protocolServer?.host !== undefined
      ? { protocolHostOverride: options.protocolServer.host }
      : {}),
  });
  const listenHost = shellPrefsState.getListenHost();
  const recoverJobs = createShellJobRecovery({ desktopDeviceId, getDelegator: () => delegator,
    getBackend: () => backend, getProtocolHandle: () => protocolHandle });
  const { onboardingService, onboardingIpc } = createShellOnboarding({
    store: onboardingStore, logger: shellLogger, gateway: gatewayService, workspace,
    prefs: shellPrefsState, getDelegator: () => delegator,
    onRuntimeReady: recoverJobs,
  });
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
          sendEnvelope: (envelope) => protocolHandle?.sendEnvelope(envelope),
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

    if (!gatewayService) {
      await recoverJobs(adapter);
    }

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
    hideMenuBar: electron.app.isPackaged === true,
    ...(options.rendererUrl
      ? { rendererUrl: options.rendererUrl }
      : { rendererHtmlPath }),
  })) as WindowWithBridgeHooks;
  installResidentWindow({
    electron, window: mainWindow, preloadPath, loginPort, listenHost, logDir, logger: shellLogger,
    setListenHost: shellPrefsState.setListenHost,
    shutdown: async () => {
      backend.stopSupervision();
      delegator?.stop();
      await lanDiscoveryHandle?.stop();
      await protocolHandle?.close();
      await gatewayService?.stop();
    },
  });
}
