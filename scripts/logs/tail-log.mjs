/**
 * 按模块读取日志尾部（或按时间过滤）。
 *
 * 职责：为 LLM Agent 提供按模块按行取日志的能力，避免一次加载整目录。
 * 不拥有：日志写入、日志内容语义。
 * 副作用：只读日志文件。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, "runtime", "logs");
const logDir = (process.env.LANXIN_LOG_DIR || DEFAULT_LOG_DIR).trim();

function parseArgs(argv) {
  const args = { module: null, lines: 200, since: null, pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--module") {
      args.module = argv[++i];
    } else if (arg === "--lines") {
      args.lines = Number.parseInt(argv[++i], 10);
    } else if (arg === "--since") {
      args.since = argv[++i];
    } else if (arg === "--pretty") {
      args.pretty = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  process.stdout.write(
    "用法: npm run logs:tail -- --module <name> [--lines N] [--since <ISO>] [--pretty]\n",
  );
  process.stdout.write(
    "模块: system protocol discovery adapter supervision audit bridge shell transport ui runtime (或 error)\n",
  );
  process.stdout.write("示例: npm run logs:tail -- --module adapter --lines 100 --pretty\n");
}

const args = parseArgs(process.argv.slice(2));
if (!args.module) {
  printUsage();
  process.exit(1);
}

const candidates = fs
  .readdirSync(logDir)
  .filter((name) => new RegExp(`^${args.module}\\.log(\\..+)?$`).test(name))
  .sort((a, b) => b.localeCompare(a));
if (candidates.length === 0) {
  process.stdout.write(`[logs:tail] 未找到 ${args.module}.log（目录: ${logDir}）\n`);
  process.exit(1);
}

const file = path.join(logDir, candidates[0]);
const lines = fs
  .readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0);

const sinceMs = args.since ? Date.parse(args.since) : null;
if (Number.isNaN(sinceMs)) {
  process.stderr.write(`[logs:tail] 无法解析 --since: ${args.since}\n`);
  process.exit(1);
}

let selected = lines;
if (sinceMs !== null) {
  selected = lines.filter((line) => {
    try {
      const parsed = JSON.parse(line);
      const time = typeof parsed.time === "string" ? Date.parse(parsed.time) : NaN;
      return Number.isFinite(time) && time >= sinceMs;
    } catch {
      return false;
    }
  });
} else {
  selected = lines.slice(-Math.max(1, args.lines));
}

process.stdout.write(`file=${file} lines=${selected.length}\n`);
for (const line of selected) {
  if (args.pretty) {
    try {
      const entry = JSON.parse(line);
      const time = typeof entry.time === "string" ? entry.time.slice(11, 19) : "?";
      const level = typeof entry.level === "string" ? entry.level.padEnd(5) : "?";
      const msg = typeof entry.msg === "string" ? entry.msg : JSON.stringify(entry);
      process.stdout.write(`${time} ${level} ${msg}\n`);
      continue;
    } catch {
      // 非 JSON 行原样输出
    }
  }
  process.stdout.write(`${line}\n`);
}
