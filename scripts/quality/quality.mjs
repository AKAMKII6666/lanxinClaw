import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function runStep(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: options.shell === true,
  });
  if (result.error) {
    console.error(result.error);
    return false;
  }
  if (result.status !== 0) {
    console.error(`${label} failed (exit ${result.status})`);
    return false;
  }
  return true;
}

const steps = [
  ["typecheck", "npm run typecheck", [], { shell: true }],
  ["check:docs-layout", "node", [path.join("scripts", "quality", "gates", "docs", "check-docs-layout.mjs")]],
  ["check:language", "node", [path.join("scripts", "quality", "gates", "language", "check-language.mjs")]],
  ["check:structure --strict", "node", [path.join("scripts", "quality", "gates", "structure", "check-structure.mjs"), "--strict"]],
  ["check:comments", "node", [path.join("scripts", "quality", "gates", "comments", "check-comments.mjs")]],
  ["test:quality", "node", ["--test", path.join("scripts", "quality", "tests", "quality-gates.test.mjs")]],
  // Windows 下 npm.cmd 需 shell；单字符串避免 DEP0190
  ["test:protocol", "npm run test:protocol", [], { shell: true }],
  ["test:mock-companion", "npm run test:mock-companion", [], { shell: true }],
  ["test:openclaw-adapter", "npm run test:openclaw-adapter", [], { shell: true }],
  ["test:companion", "npm run test:companion", [], { shell: true }],
];

for (const [label, command, args, options] of steps) {
  if (!runStep(label, command, args, options ?? {})) {
    console.error("\nquality FAILED");
    process.exit(1);
  }
}

console.log("\nquality ok");
