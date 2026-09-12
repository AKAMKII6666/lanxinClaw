#!/usr/bin/env node
/** 生成发行产物 SHA256SUMS.txt。 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const releaseDir = path.resolve(repoRoot, process.argv[2] ?? path.join("apps", "companion", "release"));

if (!fs.existsSync(releaseDir)) {
  throw new Error(`release directory not found: ${releaseDir}`);
}

const files = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^LanxinClaw-Setup-.+\.exe$/u.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

if (files.length === 0) {
  throw new Error(`no LanxinClaw installer exe found: ${releaseDir}`);
}

const lines = files.map((name) => {
  const file = path.join(releaseDir, name);
  const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return `${hash}  ${name}`;
});

fs.writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
console.log(`[write-checksums] wrote ${path.relative(repoRoot, path.join(releaseDir, "SHA256SUMS.txt"))}`);
