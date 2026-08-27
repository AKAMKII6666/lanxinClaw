/**
 * 列出日志目录中的模块文件与轮转文件。
 *
 * 职责：为 LLM Agent 提供"按模块定位日志"的目录清单（路径/大小/最新写入时间）。
 * 不拥有：日志写入、日志内容过滤。
 * 副作用：只读目录。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, "runtime", "logs");
const logDir = (process.env.LANXIN_LOG_DIR || DEFAULT_LOG_DIR).trim();

if (!fs.existsSync(logDir)) {
  process.stdout.write(`[logs:ls] 日志目录不存在: ${logDir}\n`);
  process.exit(0);
}

const files = fs
  .readdirSync(logDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.log(\.\d+)?$/.test(entry.name))
  .map((entry) => {
    const full = path.join(logDir, entry.name);
    const stat = fs.statSync(full);
    return {
      name: entry.name,
      path: full,
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString(),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

process.stdout.write(`logDir=${logDir}\n`);
process.stdout.write(`files=${files.length}\n\n`);
for (const file of files) {
  const sizeMb = (file.sizeBytes / 1024 / 1024).toFixed(2);
  process.stdout.write(
    `${file.name.padEnd(32)} ${sizeMb.padStart(8)} MB  ${file.mtime}  ${file.path}\n`,
  );
}

process.stdout.write(
  "\n用法: npm run logs:tail -- --module <name> [--lines N] [--since <ISO>] [--pretty]\n",
);
