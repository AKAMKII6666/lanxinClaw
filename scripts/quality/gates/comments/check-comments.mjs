import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, toPosix, walkFiles } from "../../lib/paths.mjs";
import { printGateResult, splitBySeverity, violation } from "../../lib/report.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const configPath = path.join(repoRoot, "scripts/quality/config/quality-gate-config.json");

function lineAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function hasHeaderComment(text) {
  return /^\s*\/\*\*[\s\S]*?(职责|不拥有|副作用|纯函数)[\s\S]*?\*\//.test(text) || /^\s*\/\/\s*职责/.test(text);
}

function leadingDoc(text, offset) {
  const before = text.slice(0, offset);
  const match = before.match(/\/\*\*[\s\S]*?\*\/\s*$/);
  return match ? match[0] : "";
}

function isPlaceholder(comment) {
  const body = comment.replace(/[/*]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!body) return true;
  return ["todo", "fixme", "placeholder", "占位", "待补充", "说明一下", "xxx"].some((word) => body === word || body.startsWith(`${word} `));
}

function parseParams(paramText) {
  return paramText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/=.*$/, "").replace(/\??\s*:\s*.*$/, "").replace(/^\.\.\./, "").trim())
    .filter((part) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part));
}

function returnsVoid(signatureTail) {
  return /:\s*(void|undefined|never)\b/.test(signatureTail);
}

function analyzeSuppressions(text, rel) {
  const violations = [];
  const lines = text.split(/\r?\n/);
  const suppressRe = /^\s*(?:\/\/|\/\*)\s*(?:eslint-disable(?:-next-line|-line)?|@ts-(?:ignore|expect-error|nocheck))/;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!suppressRe.test(line)) continue;
    const prev = index > 0 ? lines[index - 1] : "";
    const combined = `${prev}\n${line}`;
    if (!/(原因|because|reason|退出|exitCondition|临时|rationale|why)/i.test(combined)) {
      violations.push(
        violation("COMMENT-004", rel, "抑制指令缺少就近原因说明", "写明原因；临时项还要写退出条件", { line: index + 1 }),
      );
    }
  }
  return violations;
}

function analyzeExportedFunctions(text, rel) {
  const violations = [];
  const fnRe = /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)([^{;]*)/g;
  let match;
  while ((match = fnRe.exec(text))) {
    const [full, name, params, tail] = match;
    const doc = leadingDoc(text, match.index);
    const line = lineAt(text, match.index);
    if (!doc) {
      violations.push(violation("COMMENT-001", rel, `导出函数 ${name} 缺少 JSDoc`, "补充意图、约束、@param 和 @returns", { line }));
      continue;
    }
    if (isPlaceholder(doc)) {
      violations.push(violation("COMMENT-005", rel, `导出函数 ${name} 的注释无效`, "注释要解释意图、约束、时序或副作用", { line }));
    }
    for (const param of parseParams(params)) {
      if (!new RegExp(`@param\\s+${param}\\b`).test(doc)) {
        violations.push(violation("COMMENT-002", rel, `导出函数 ${name} 缺少 @param ${param}`, "为每个入参说明来源、单位或约束", { line }));
      }
    }
    if (!returnsVoid(tail) && !/@returns\b/.test(doc)) {
      violations.push(violation("COMMENT-003", rel, `导出函数 ${name} 缺少 @returns`, "说明返回值语义和错误/空值含义", { line }));
    }
    fnRe.lastIndex = match.index + full.length;
  }
  return violations;
}

function analyzeExportedTypes(text, rel) {
  const violations = [];
  const typeRe = /export\s+(interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)[^{=]*(?:=\s*)?\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = typeRe.exec(text))) {
    const [, kind, name, body] = match;
    const line = lineAt(text, match.index);
    const doc = leadingDoc(text, match.index);
    if (!doc) {
      violations.push(violation("COMMENT-001", rel, `导出 ${kind} ${name} 缺少 JSDoc`, "说明所有权、生命周期和用途", { line }));
    }
    const bodyLines = body.split(/\r?\n/);
    for (let index = 0; index < bodyLines.length; index += 1) {
      const field = bodyLines[index].match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:/);
      if (!field) continue;
      const prev = index > 0 ? bodyLines[index - 1].trim() : "";
      if (!prev.startsWith("/**") && !prev.startsWith("*") && !prev.startsWith("//")) {
        violations.push(
          violation("COMMENT-006", rel, `字段 ${name}.${field[1]} 缺少字段说明`, "补充所有权、可空语义、持久化或生命周期说明", { line: line + index + 1 }),
        );
      }
    }
  }
  return violations;
}

function isStrictFile(rel, config) {
  return (config.strictContractDirs ?? []).some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

async function collectSourceFiles(root, config) {
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

export async function runCommentGate(options = {}) {
  const root = options.root ?? repoRoot;
  const config = options.config ?? JSON.parse(await readFile(options.configPath ?? configPath, "utf8"));
  const files = await collectSourceFiles(root, config);
  const violations = [];

  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    const text = await readFile(file, "utf8");
    violations.push(...analyzeSuppressions(text, rel));
    if (!isStrictFile(rel, config)) continue;
    if (!hasHeaderComment(text)) {
      violations.push(violation("COMMENT-007", rel, "严格契约文件缺少文件头职责注释", "说明模块职责、不拥有的职责、纯函数或副作用性质"));
    }
    violations.push(...analyzeExportedFunctions(text, rel));
    violations.push(...analyzeExportedTypes(text, rel));
  }

  const bySeverity = splitBySeverity(violations);
  return { ...bySeverity, violations, filesChecked: files.length };
}

async function main() {
  const result = await runCommentGate();
  printGateResult("check:comments", result);
  if (result.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
