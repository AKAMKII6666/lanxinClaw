/**
 * Companion renderer Vite 配置。
 *
 * 职责：开发期 HMR 与打包 Electron 可 loadFile 的静态资源。
 * 不拥有：main 进程、配对/权限业务。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const companionRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(companionRoot, "src", "ui"),
  base: "./",
  publicDir: path.join(companionRoot, "src", "shell", "desktop", "icons"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.join(companionRoot, "dist", "renderer"),
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    // 与源码中的 `.js` 扩展 import 对齐到 TS/TSX
    extensions: [".mjs", ".js", ".ts", ".tsx", ".json"],
  },
});
