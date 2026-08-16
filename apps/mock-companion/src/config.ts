/**
 * Mock companion 运行时配置。
 *
 * 职责：端口、设备身份、job 模拟场景与延迟。
 * 不拥有：配对裁决持久化、真实 OpenClaw 启动、凭据存储。
 * 纯函数：从环境变量读取后返回不可变快照；无网络副作用。
 */

/** job 模拟收尾场景：completed 进入验收等待；blocked 停在阻塞 */
export type MockJobScenario = "completed" | "blocked";

/**
 * Mock companion 配置快照。
 */
export interface MockCompanionConfig {
  /** HTTP + WebSocket 共用监听端口 */
  port: number;
  /** 本机 companion 设备 id；会话认证以配对身份为准 */
  desktopDeviceId: string;
  /** companion 展示名 */
  desktopDisplayName: string;
  /** companion 版本标签（非 secret） */
  companionVersion: string;
  /** mock worker 场景 */
  jobScenario: MockJobScenario;
  /** 各阶段模拟延迟（毫秒） */
  stepDelayMs: number;
  /** 服务启动时间 */
  startedAtMs: number;
}

/**
 * 解析 job 场景环境变量。
 *
 * @param raw 原始字符串
 * @returns 合法场景；非法时回退 completed
 */
function parseJobScenario(raw: string | undefined): MockJobScenario {
  if (raw === "blocked") {
    return "blocked";
  }
  return "completed";
}

/**
 * 从环境变量构建配置；缺省适合本机联调。
 *
 * @param env 环境变量字典，默认 `process.env`
 * @returns 配置快照
 */
export function loadMockCompanionConfig(
  env: NodeJS.ProcessEnv = process.env,
): MockCompanionConfig {
  const portRaw = env.MOCK_COMPANION_PORT ?? "8787";
  const port = Number.parseInt(portRaw, 10);
  const delayRaw = env.MOCK_COMPANION_STEP_DELAY_MS ?? "40";
  const stepDelayMs = Number.parseInt(delayRaw, 10);
  return {
    port: Number.isFinite(port) && port > 0 ? port : 8787,
    desktopDeviceId: env.MOCK_COMPANION_DEVICE_ID ?? "desktop_mock_001",
    desktopDisplayName: env.MOCK_COMPANION_DISPLAY_NAME ?? "Lanxing Mock Companion",
    companionVersion: "0.1.0-mock",
    jobScenario: parseJobScenario(env.MOCK_JOB_SCENARIO),
    stepDelayMs: Number.isFinite(stepDelayMs) && stepDelayMs >= 0 ? stepDelayMs : 40,
    startedAtMs: Date.now(),
  };
}
