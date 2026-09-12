/** 联合测试装配：真实 phone 模块、真实 WS/backend/gate，runtime 明确使用可控替身。 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { runShellBridgeAction } from "../../apps/companion/src/shell/desktop/bridge-outbound.js";
import { flushPendingContext } from "../../apps/companion/src/protocol-server/bridge-actions.js";
import { PROTOCOL_VERSION } from "@lanxin-claw/protocol";
import { OpenClawAdapter, createMutableMockOpenClawRuntimeClient } from "@lanxin-claw/openclaw-adapter";
import { createCompanionBackendRuntime } from "../../apps/companion/src/backend/runtime.js";
import { createDeviceIdentityStore, MemoryIdentityPersistence } from "../../apps/companion/src/credentials/identity-store.js";
import { startCompanionProtocolServer } from "../../apps/companion/src/protocol-server/server.js";
import { JobDelegator } from "../../apps/companion/src/jobs/delegation/delegator.js";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const phoneRoot = path.resolve(process.env.LANXIN_PHONE_REPO || path.join(root, "../doubaoSister"));
const { createLanxinClawRuntime } = require(path.join(phoneRoot, "phone/systems/lanxinClaw/lanxinClawRuntime.js"));
const { createCompanionToolHandler } = require(path.join(phoneRoot, "phone/systems/lanxinClaw/companionToolHandler.js"));

export async function startCrossRepoHarness() {
  let inCall = false;
  const injections: string[] = [];
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "lanxin-cross-repo-"));
  const backend = createCompanionBackendRuntime({
    onBridgeAction: (action, result) => runShellBridgeAction({ backend, desktopDeviceId: "desktop_cross",
      getDelegator: () => delegator, broadcast: (envelope) => server.broadcast(envelope),
      sendEnvelope: (envelope) => server.sendEnvelope(envelope), approvePairing: null,
      openLogDir: () => {}, logger: pino({ level: "silent" }),
    }, action, result),
  });
  const identityStore = createDeviceIdentityStore(new MemoryIdentityPersistence());
  const ids = { phoneDeviceId: "phone_cross", desktopDeviceId: "desktop_cross" };
  const identity = await identityStore.savePairedIdentity({
    ...ids, pairingId: "pair_cross", phoneDisplayName: "测试电话", desktopDisplayName: "测试桌面", pairedAt: new Date().toISOString(),
  });
  const runtime = createMutableMockOpenClawRuntimeClient();
  const adapter = new OpenClawAdapter({ runtime: runtime.client });
  const server = await startCompanionProtocolServer({ backend, identityStore,
    onSessionAccepted: () => flushPendingContext({ getParty: () => ids,
      isSessionAuthenticated: () => backend.getState().connection.sessionAuthenticated,
      hasActiveCall: () => false, getAffair: (id) => backend.getState().affairs.get(id),
      pendingContext: backend.getPendingContext(), broadcast: (envelope) => { server.broadcast(envelope); },
    }),
    onJobCancel: (job) => delegator.cancelJob(job),
    pairing: { desktopDeviceId: ids.desktopDeviceId, desktopDisplayName: "测试桌面" },
  });
  const delegator = new JobDelegator({
    adapter, gate: backend.getPermissionGate(), desktopDeviceId: ids.desktopDeviceId,
    getJob: (id) => backend.getState().jobs.get(id),
    isAffairClosing: (id) => backend.getAffairActions().isClosing(id),
    runAffairOperation: (id, operation) => backend.getAffairActions().operations.run(id, operation),
    getJobStatus: (id) => backend.getState().jobs.get(id)?.status,
    getJobPurpose: (id) => backend.getState().jobs.get(id)?.purpose,
    getAffair: (id) => backend.getState().affairs.get(id),
    getPhoneDeviceId: () => backend.getState().connection.phoneDeviceId,
    applyProtocolEnvelope: (envelope) => backend.applyProtocolEnvelope(envelope),
    sendEnvelope: server.sendEnvelope, pollIntervalMs: 10,
  });
  const phone = createLanxinClawRuntime({
    isInCall: () => inCall, getRealtimeClient: () => ({ sendSyntheticUserText: (text: string) => { injections.push(text); return true; } }),
    runtimePaths: { getRuntimeRoot: () => runtimeRoot }, phoneDeviceId: ids.phoneDeviceId,
    jobCreateAckTimeoutMs: 1000, jobPermissionEventTimeoutMs: 500,
  });
  phone.store.saveDevice({ ...ids, schemaVersion: 1, protocolVersion: PROTOCOL_VERSION,
    pairingLifecycle: "active", pairingSecret: identity.pairingSecret,
  });
  await phone.openSession(server.wsUrl);
  return {
    phone, backend, server, runtime, adapter, delegator, ids,
    injections, setInCall: (next: boolean) => { inCall = next; },
    createToolHandler: (client: object) => createCompanionToolHandler({ client, runtime: phone, agentId: "zhang-boss" }),
    close: async () => { phone.close(); delegator.stop(); backend.stopSupervision(); await server.close(); },
  };
}

export async function waitUntil(predicate: () => boolean, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error("cross_repo_condition_timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
