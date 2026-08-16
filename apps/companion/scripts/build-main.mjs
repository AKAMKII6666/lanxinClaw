/**
 * 构建 Electron main 产物：打包 main-entry 并复制 preload。
 *
 * 职责：产出 dist/main/main-entry.cjs 与 preload.cjs。
 * 不拥有：renderer Vite 构建。
 * 副作用：写 dist/main。
 */

import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const companionRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(companionRoot, "dist", "main");
const entry = path.join(
  companionRoot,
  "src",
  "shell",
  "desktop",
  "entry",
  "main-entry.ts",
);
const preloadSrc = path.join(companionRoot, "src", "shell", "desktop", "preload.cjs");

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(outDir, "main-entry.cjs"),
  // 工作区 package 为 ESM-only，须打进 bundle；仅 external 原生 electron
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});

copyFileSync(preloadSrc, path.join(outDir, "preload.cjs"));
process.stdout.write(`[build-main] ok -> ${outDir}\n`);
