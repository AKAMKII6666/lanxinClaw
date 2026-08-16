import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, toPosix, walkFiles } from "../../lib/paths.mjs";
import { printGateResult, splitBySeverity, violation } from "../../lib/report.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const configPath = path.join(repoRoot, "scripts/quality/config/quality-gate-config.json");

const TECHNICAL_WORDS = new Set([
  "OpenClaw",
  "Lanxing",
  "Claw",
  "Companion",
  "Zhang",
  "Boss",
  "Protocol",
  "Discovery",
  "Pairing",
  "Session",
  "Affair",
  "Job",
  "Chat",
  "Permission",
  "WebSocket",
  "TypeScript",
  "JSDoc",
  "JSON",
  "Schema",
  "API",
  "MVP",
  "LAN",
  "USB",
  "UI",
  "SDK",
]);

function hasChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function stripAllowedEnglish(text) {
  return text
    .replace(/`[^`]*`/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[A-Za-z]:[\\/][^\s)]+/g, "")
    .replace(/[./\\][A-Za-z0-9._~:/\\-]+/g, "")
    .replace(/\b[a-z]+(?:\.[a-z_]+)+\b/g, "")
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, "")
    .replace(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g, (word) => (TECHNICAL_WORDS.has(word) ? "" : word));
}

function englishLetterCount(text) {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

function shouldCheckNaturalLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^[-|:]+$/.test(trimmed)) return false;
  if (/^[>|#*\-\d.\s`/\\()[\]{}:.,_+=@"']+$/.test(trimmed)) return false;
  if (/^\|?\s*[-: ]+\|/.test(trimmed)) return false;
  return true;
}

function isEnglishProseLine(line) {
  if (!shouldCheckNaturalLine(line)) return false;
  const stripped = stripAllowedEnglish(line);
  if (hasChinese(stripped)) return false;
  return englishLetterCount(stripped) >= 24;
}

function analyzeMarkdown(text, rel) {
  const violations = [];
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (isEnglishProseLine(line)) {
      violations.push(
        violation(
          "LANG-001",
          rel,
          "文档正文出现整段英文",
          "改成中文；字段名、API、命令、路径和专业名词可保留英文",
          { line: index + 1 },
        ),
      );
    }
  }
  return violations;
}

function analyzeCodeComments(text, rel) {
  const violations = [];
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const startsBlock = /^\s*\/\*/.test(line);
    const startsLine = /^\s*\/\//.test(line);
    if (startsBlock) inBlock = true;
    const isCommentLine = startsLine || inBlock || /^\s*\*/.test(line);
    if (isCommentLine) {
      const body = trimmed.replace(/^\/\*+/, "").replace(/^\*/, "").replace(/^\//, "").replace(/\*\/$/, "").trim();
      if (isEnglishProseLine(body)) {
        violations.push(
          violation(
            "LANG-002",
            rel,
            "代码注释出现整段英文",
            "注释改用中文；字段名、API 和专业名词可保留英文",
            { line: index + 1 },
          ),
        );
      }
    }
    if (inBlock && /\*\//.test(line)) inBlock = false;
  }
  return violations;
}

async function collectMarkdownFiles(root) {
  const files = [];
  for (const relRoot of ["docs", ".cursor"]) {
    const abs = path.join(root, relRoot);
    if (!(await exists(abs))) continue;
    // skills 是外置工具文档，不纳入项目正文语言门禁；rules 仍检查。
    files.push(
      ...(await walkFiles(abs, {
        extensions: new Set([".md", ".mdc"]),
        excludeDirNames: new Set(["node_modules", ".git", "skills"]),
      })),
    );
  }
  return files;
}

async function collectCodeFiles(root, config) {
  const files = [];
  for (const relRoot of config.sourceRoots ?? []) {
    const abs = path.join(root, relRoot);
    if (!(await exists(abs))) continue;
    files.push(
      ...(await walkFiles(abs, {
        extensions: new Set(config.sourceExtensions ?? []),
        excludeDirNames: new Set(config.excludeDirNames ?? []),
      })),
    );
  }
  return files.filter((file) => !file.endsWith(".d.ts"));
}

export async function runLanguageGate(options = {}) {
  const root = options.root ?? repoRoot;
  const config = options.config ?? JSON.parse(await readFile(options.configPath ?? configPath, "utf8"));
  const markdownFiles = await collectMarkdownFiles(root);
  const codeFiles = await collectCodeFiles(root, config);
  const violations = [];

  for (const file of markdownFiles) {
    const rel = toPosix(path.relative(root, file));
    violations.push(...analyzeMarkdown(await readFile(file, "utf8"), rel));
  }
  for (const file of codeFiles) {
    const rel = toPosix(path.relative(root, file));
    violations.push(...analyzeCodeComments(await readFile(file, "utf8"), rel));
  }

  const bySeverity = splitBySeverity(violations);
  return { ...bySeverity, violations, filesChecked: markdownFiles.length + codeFiles.length };
}

async function main() {
  const result = await runLanguageGate();
  printGateResult("check:language", result);
  if (result.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
