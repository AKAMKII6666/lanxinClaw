/**
 * OpenClaw adapter 公共门面。
 *
 * 职责：导出 create/read/cancel job API、状态映射、mock 与本机低风险只读 runtime。
 * 不拥有：配对、凭据授权、事务关闭、张老板人格；OpenClaw 只做 worker。
 * 副作用：本文件只做 re-export；OpenClawAdapter 方法会产生 runtime I/O（须经 companion 权限层）。
 */

export { ADAPTER_CONTRACT_VERSION, getOpenClawAdapterPackageName } from "./package-meta.js";

export { OpenClawAdapter, type OpenClawAdapterOptions } from "./adapter.js";

export type {
  CreateAdapterJobInput,
  AdapterJobRecord,
  AdapterJobResult,
} from "./jobs/job-types.js";

export {
  createMemoryAdapterJobStore,
  type AdapterJobStore,
  type AdapterJobPersistence,
} from "./jobs/job-store.js";
export { createFileAdapterJobStore } from "./jobs/file-job-store.js";

export { createAdapterJob } from "./jobs/create-job.js";
export { readAdapterJob } from "./jobs/read-job.js";
export { cancelAdapterJob } from "./jobs/cancel-job.js";

export type {
  OpenClawRuntimeClient,
  CreateOpenClawRunParams,
  OpenClawRunSnapshot,
} from "./client/runtime-client.js";

export {
  createMockOpenClawRuntimeClient,
  createMutableMockOpenClawRuntimeClient,
  type MutableMockOpenClawRuntime,
} from "./client/mock-runtime-client.js";

export {
  createLocalSafeRuntimeClient,
  type LocalSafeRuntimeOptions,
} from "./client/local-safe/runtime-client.js";
export {
  createGatewayRuntimeClient,
  type GatewayAuthProvider,
  type GatewayRuntimeClientOptions,
} from "./client/gateway/runtime-client.js";
export {
  createUnavailableGatewayTransport,
  GatewayTransportError,
  type GatewayCreateRunRequest,
  type GatewayTransport,
} from "./client/gateway/transport.js";
export {
  createFakeGatewayTransport,
  type FakeGatewayTransport,
} from "./client/gateway/fake/transport.js";
export {
  createRawWebSocketGatewayTransport,
  type RawGatewayMethodNames,
  type RawWebSocketGatewayTransportOptions,
} from "./client/gateway/raw-ws/transport.js";

export {
  LOW_RISK_TASK_KINDS,
  LOW_RISK_GOAL_PREFIX,
  buildLowRiskGoal,
  parseLowRiskTaskKind,
  requiredPermissionsForLowRisk,
  type LowRiskTaskKind,
} from "./client/local-safe/task-kinds.js";

export {
  OPENCLAW_RUN_STATUSES,
  isOpenClawRunStatus,
  type OpenClawRunStatus,
} from "./status/openclaw-run-status.js";

export { mapOpenClawRunStatusToJobStatus } from "./mapping/map-run-status.js";
