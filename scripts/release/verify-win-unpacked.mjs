#!/usr/bin/env node
/**
 * 校验 electron-builder 产出的 Windows unpacked 包含完整隔离 runtime。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath,pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const releaseDir = path.resolve(repoRoot, process.argv[2] ?? "apps/companion/release");
const resourcesDir = path.join(releaseDir, "win-unpacked", "resources");
const openclawDir = path.join(resourcesDir, "openclaw");
const nodeBin = path.join(resourcesDir, "node", "node.exe");

const requiredFiles = [
  path.join(openclawDir, "openclaw.mjs"),
  path.join(openclawDir, "node_modules", "json5", "package.json"),
  path.join(openclawDir, "node_modules", "@openclaw", "ai", "package.json"),
  nodeBin,
  path.join(resourcesDir, "openclaw-provider-seeds", "qwen-provider-2026.7.1.tgz"),
  path.join(resourcesDir, "runtime-manifest.json"),
];

for (const item of requiredFiles) {
  if (!fs.existsSync(item)) {
    throw new Error(`win-unpacked runtime missing: ${path.relative(repoRoot, item)}`);
  }
}

verifyOpenClawStartupImports();
console.log(`[verify-win-unpacked] ok -> ${path.relative(repoRoot, resourcesDir)}`);

function verifyOpenClawStartupImports() {
  const distDir = path.join(openclawDir, "dist");
  const redactModules = fs
    .readdirSync(distDir)
    .filter((name) => /^redact-.+\.js$/u.test(name));
  if (redactModules.length === 0) {
    throw new Error(`OpenClaw dist missing redact modules: ${path.relative(repoRoot, distDir)}`);
  }
  for (const moduleName of redactModules) {
    run(nodeBin, [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(pathToFileURL(path.join(distDir, moduleName)).href)});`,
    ]);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: openclawDir,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }
}
