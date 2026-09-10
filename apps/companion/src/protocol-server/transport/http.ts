/** HTTP 监听与服务关闭；snapshot 的回环访问限制在此检查。 */
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { isLoopbackAddress } from "../guards/http/http-guard.js";
import type {
CompanionProtocolServerOptions
} from "../server-types.js";


/**
 * 创建 HTTP server。
 *
 * @param options 选项
 * @returns HTTP server
 */
export function createProtocolHttpServer(options: CompanionProtocolServerOptions): HttpServer {
  return createServer((req, res) => {
    if (req.url === "/health") {
      writeJson(res, 200, { ok: true, service: "lanxin-companion-protocol" });
      return;
    }
    if (req.url === "/snapshot") {
      const remote = req.socket.remoteAddress;
      if (!isLoopbackAddress(remote)) {
        writeJson(res, 403, { ok: false, error: { code: "snapshot_loopback_only", message: "snapshot 仅本机回环可访问" } });
        return;
      }
      writeJson(res, 200, options.backend.getSnapshot());
      return;
    }
    writeJson(res, 404, { ok: false, error: { code: "not_found", message: "未知 endpoint" } });
  });
}

/**
 * 监听端口。
 */
export async function listen(server: HttpServer, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}

/**
 * 关闭 server。
 */
export async function closeServer(
  httpServer: HttpServer,
  wss: WebSocketServer,
  clients: Set<WebSocket>,
): Promise<void> {
  for (const client of clients) {
    client.terminate();
  }
  clients.clear();
  for (const client of wss.clients) {
    client.terminate();
  }
  await new Promise<void>((resolve, reject) => {
    wss.close((err) => {
      if (!err || err.message === "The server is not running") {
        resolve();
        return;
      }
      reject(err);
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => {
      if (!err || (err as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(err);
    });
  });
}

/**
 * 写 HTTP JSON。
 */
function writeJson(
  res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
