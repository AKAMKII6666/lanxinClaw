/**
 * Mock companion 服务装配与生命周期。
 *
 * 职责：启动共享端口上的 HTTP + WebSocket，暴露 UI 契约与协议通道。
 * 不拥有：真实 OpenClaw、桌面权限 UI、电话主仓。
 * 副作用：监听本机 TCP 端口；进程内内存态。
 */

import { createServer, type Server as HttpServer } from "node:http";
import {
  loadMockCompanionConfig,
  type MockCompanionConfig,
} from "./config.js";
import { handleHttpRequest } from "./bridge/http-routes.js";
import { attachWsHub, type WsHub } from "./bridge/ws-hub.js";
import { createMemoryStore, type MemoryStore } from "./store/memory-store.js";

/**
 * 已启动的 mock companion 句柄。
 */
export interface MockCompanionHandle {
  /** 生效配置 */
  config: MockCompanionConfig;
  /** 内存 store（只读观察用） */
  store: MemoryStore;
  /** 基础 HTTP URL */
  baseUrl: string;
  /** WebSocket URL */
  wsUrl: string;
  /** 关闭服务 */
  close: () => Promise<void>;
}

/**
 * 启动 mock companion。
 *
 * @param overrides 可选配置覆盖（如 port）
 * @returns 句柄
 */
export async function startMockCompanion(
  overrides: Partial<MockCompanionConfig> = {},
): Promise<MockCompanionHandle> {
  const base = loadMockCompanionConfig();
  const config: MockCompanionConfig = { ...base, ...overrides, startedAtMs: Date.now() };
  const store = createMemoryStore(config.startedAtMs);

  let hub: WsHub | null = null;
  let runtimeConfig = config;
  const httpServer: HttpServer = createServer((req, res) => {
    const emit = (envelope: Parameters<WsHub["broadcast"]>[0]): void => {
      hub?.broadcast(envelope);
    };
    void handleHttpRequest(req, res, store, runtimeConfig, emit).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "unknown error";
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: { code: "internal", message, retryable: true } }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    throw new Error("mock companion 未能绑定 TCP 端口");
  }
  const boundPort = address.port;
  runtimeConfig = { ...config, port: boundPort };

  hub = attachWsHub(httpServer, store, runtimeConfig);
  const baseUrl = `http://127.0.0.1:${boundPort}`;
  const wsUrl = `ws://127.0.0.1:${boundPort}/ws`;

  return {
    config: runtimeConfig,
    store,
    baseUrl,
    wsUrl,
    close: async () => {
      await hub?.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}
