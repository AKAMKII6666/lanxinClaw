/**
 * Mock companion CLI 入口。
 *
 * 职责：以前台进程方式启动 HTTP/WS mock 服务。
 * 不拥有：模拟电话脚本、质量门禁编排。
 * 副作用：监听端口直到进程收到 SIGINT/SIGTERM。
 */

import { startMockCompanion } from "./server.js";

const handle = await startMockCompanion();
process.stdout.write(
  `[mock-companion] listening http=${handle.baseUrl} ws=${handle.wsUrl} scenario=${handle.config.jobScenario}\n`,
);

/**
 * 优雅关闭。
 *
 * @returns Promise
 */
async function shutdown(): Promise<void> {
  process.stdout.write("[mock-companion] shutting down\n");
  await handle.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
