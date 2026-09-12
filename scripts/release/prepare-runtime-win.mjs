#!/usr/bin/env node
/**
 * 准备 Windows 发行用的隔离 OpenClaw runtime。
 *
 * 输出：
 * - .release/runtime/openclaw/
 * - .release/runtime/node/
 * - .release/runtime/openclaw-provider-seeds/
 * - .release/runtime/runtime-manifest.json
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath,pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const releaseRoot = path.join(repoRoot, ".release");
const cacheDir = path.join(releaseRoot, "cache");
const stagingDir = path.join(releaseRoot, "staging");
const runtimeDir = path.join(releaseRoot, "runtime");

const OPENCLAW_VERSION = "2026.7.1-2";
const OPENCLAW_TARBALL = `openclaw-${OPENCLAW_VERSION}.tgz`;
const OPENCLAW_URL = `https://registry.npmjs.org/openclaw/-/${OPENCLAW_TARBALL}`;
const OPENCLAW_INTEGRITY = "sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==";

const NODE_VERSION = "24.15.0";
const NODE_ARCHIVE = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}`;
const NODE_SHA256 = "cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62";

const QWEN_VERSION = "2026.7.1";
const QWEN_TARBALL = `qwen-provider-${QWEN_VERSION}.tgz`;
const QWEN_URL = `https://registry.npmjs.org/@openclaw/qwen-provider/-/${QWEN_TARBALL}`;
const QWEN_INTEGRITY = "sha512-1UqH8MY0gGL8rtTEKBI/M4PEtSAuPNEs8DodJ7y752p3pE2BkIPed6Sm1RRJ+g1WfL0IxmTlkxdwZ8xXrdBhqw==";

const OPENCLAW_RUNTIME_COMPAT_DEPS = [
  {
    package: "json5",
    spec: "json5@2.2.3",
    reason: "OpenClaw gateway startup imports dist/redact modules that require json5.",
  },
];

const artifacts = [
  {
    name: "OpenClaw",
    url: OPENCLAW_URL,
    file: path.join(cacheDir, OPENCLAW_TARBALL),
    integrity: OPENCLAW_INTEGRITY,
  },
  {
    name: "Node.js",
    url: NODE_URL,
    file: path.join(cacheDir, NODE_ARCHIVE),
    sha256: NODE_SHA256,
  },
  {
    name: "Qwen provider",
    url: QWEN_URL,
    file: path.join(cacheDir, QWEN_TARBALL),
    integrity: QWEN_INTEGRITY,
  },
];

await main();

async function main() {
  prepareCleanDir(runtimeDir);
  prepareCleanDir(stagingDir);
  fs.mkdirSync(cacheDir, { recursive: true });

  for (const artifact of artifacts) {
    await downloadAndVerify(artifact);
  }

  prepareOpenClaw();
  prepareNode();
  prepareProviderSeeds();
  writeManifest();
  verifyRuntimeLayout();
  verifyOpenClawRuntime();

  console.log(`[prepare-runtime-win] ok -> ${path.relative(repoRoot, runtimeDir)}`);
}

function prepareCleanDir(dir) {
  assertInsideReleaseRoot(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function assertInsideReleaseRoot(target) {
  const rel = path.relative(releaseRoot, path.resolve(target));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`refusing to modify path outside .release: ${target}`);
  }
}

async function downloadAndVerify(artifact) {
  if (fs.existsSync(artifact.file)) {
    const cached = fs.readFileSync(artifact.file);
    if (verifyBuffer(cached, artifact)) {
      console.log(`[prepare-runtime-win] cache hit: ${artifact.name}`);
      return;
    }
    fs.rmSync(artifact.file, { force: true });
  }

  console.log(`[prepare-runtime-win] download: ${artifact.name}`);
  const response = await fetch(artifact.url);
  if (!response.ok) {
    throw new Error(`download failed: ${artifact.url} -> ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!verifyBuffer(buffer, artifact)) {
    throw new Error(`checksum mismatch: ${artifact.name}`);
  }
  fs.writeFileSync(artifact.file, buffer);
}

function verifyBuffer(buffer, artifact) {
  if (artifact.integrity) {
    const expected = artifact.integrity.replace(/^sha512-/u, "");
    const actual = createHash("sha512").update(buffer).digest("base64");
    return expected === actual;
  }
  if (artifact.sha256) {
    const actual = createHash("sha256").update(buffer).digest("hex");
    return artifact.sha256 === actual;
  }
  return true;
}

function prepareOpenClaw() {
  const extractDir = path.join(stagingDir, "openclaw");
  prepareCleanDir(extractDir);
  run("tar", ["-xzf", path.join(cacheDir, OPENCLAW_TARBALL), "-C", extractDir]);
  const packageDir = path.join(extractDir, "package");
  const dest = path.join(runtimeDir, "openclaw");
  fs.cpSync(packageDir, dest, { recursive: true });
  run(
    "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false"],
    {
      cwd: dest,
      env: {
        OPENCLAW_CONFIG_PATH: path.join(stagingDir, "openclaw-postinstall", "openclaw.json"),
        OPENCLAW_DISABLE_PLUGIN_REGISTRY_MIGRATION: "1",
        OPENCLAW_STATE_DIR: path.join(stagingDir, "openclaw-postinstall", "state"),
      },
    },
  );
  installOpenClawRuntimeCompatibilityDependencies(dest);
}

function installOpenClawRuntimeCompatibilityDependencies(openclawDir) {
  for (const dep of OPENCLAW_RUNTIME_COMPAT_DEPS) {
    if (hasInstalledPackage(openclawDir, dep.package)) {
      continue;
    }
    console.log(`[prepare-runtime-win] runtime dependency patch: ${dep.spec}`);
    run(
      "npm",
      ["install", "--no-save", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", dep.spec],
      { cwd: openclawDir },
    );
  }
}

function hasInstalledPackage(packageRoot, packageName) {
  return fs.existsSync(path.join(packageRoot, "node_modules", ...packageName.split("/"), "package.json"));
}

function prepareNode() {
  const extractDir = path.join(stagingDir, "node");
  prepareCleanDir(extractDir);
  run("tar", ["-xf", path.join(cacheDir, NODE_ARCHIVE), "-C", extractDir]);
  const packageDir = path.join(extractDir, `node-v${NODE_VERSION}-win-x64`);
  fs.cpSync(packageDir, path.join(runtimeDir, "node"), { recursive: true });
}

function prepareProviderSeeds() {
  const destDir = path.join(runtimeDir, "openclaw-provider-seeds");
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(cacheDir, QWEN_TARBALL), path.join(destDir, QWEN_TARBALL));
}

function writeManifest() {
  const manifest = {
    schemaVersion: 1,
    platform: "win32",
    arch: "x64",
    generatedAt: new Date().toISOString(),
    artifacts: {
      openclaw: {
        version: OPENCLAW_VERSION,
        source: OPENCLAW_URL,
        integrity: OPENCLAW_INTEGRITY,
        entry: "openclaw/openclaw.mjs",
        runtimeCompatibilityDependencies: OPENCLAW_RUNTIME_COMPAT_DEPS.map((dep) => ({
          package: dep.package,
          spec: dep.spec,
          reason: dep.reason,
        })),
      },
      node: {
        version: NODE_VERSION,
        source: NODE_URL,
        sha256: NODE_SHA256,
        entry: "node/node.exe",
      },
      qwenProvider: {
        package: "@openclaw/qwen-provider",
        version: QWEN_VERSION,
        source: QWEN_URL,
        integrity: QWEN_INTEGRITY,
        archive: `openclaw-provider-seeds/${QWEN_TARBALL}`,
      },
    },
  };
  fs.writeFileSync(
    path.join(runtimeDir, "runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function verifyRuntimeLayout() {
  const required = [
    path.join(runtimeDir, "openclaw", "openclaw.mjs"),
    path.join(runtimeDir, "openclaw", "package.json"),
    path.join(runtimeDir, "openclaw", "node_modules"),
    path.join(runtimeDir, "openclaw", "node_modules", "json5", "package.json"),
    path.join(runtimeDir, "node", "node.exe"),
    path.join(runtimeDir, "openclaw-provider-seeds", QWEN_TARBALL),
    path.join(runtimeDir, "runtime-manifest.json"),
  ];
  for (const item of required) {
    if (!fs.existsSync(item)) {
      throw new Error(`runtime layout missing: ${path.relative(repoRoot, item)}`);
    }
  }
}

function verifyOpenClawRuntime() {
  run(
    path.join(runtimeDir, "node", "node.exe"),
    [path.join(runtimeDir, "openclaw", "openclaw.mjs"), "--version"],
    { cwd: path.join(runtimeDir, "openclaw") },
  );
  verifyOpenClawStartupImports();
}

function verifyOpenClawStartupImports() {
  const openclawDir = path.join(runtimeDir, "openclaw");
  const distDir = path.join(openclawDir, "dist");
  const redactModules = fs
    .readdirSync(distDir)
    .filter((name) => /^redact-.+\.js$/u.test(name));
  if (redactModules.length === 0) {
    throw new Error(`OpenClaw dist missing redact modules: ${path.relative(repoRoot, distDir)}`);
  }
  for (const moduleName of redactModules) {
    run(
      path.join(runtimeDir, "node", "node.exe"),
      [
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(pathToFileURL(path.join(distDir, moduleName)).href)});`,
      ],
      { cwd: openclawDir },
    );
  }
}

function run(command, args, options = {}) {
  const invocation = wrapCommand(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
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

function wrapCommand(command, args) {
  if (process.platform === "win32" && command === "npm") {
    const comspec = process.env.ComSpec || "cmd.exe";
    return {
      command: comspec,
      args: ["/d", "/s", "/c", "npm", ...args],
    };
  }
  return { command, args };
}
