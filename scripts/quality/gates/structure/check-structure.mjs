import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, toPosix, walkFiles } from "../../lib/paths.mjs";
import { printGateResult, splitBySeverity, violation } from "../../lib/report.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const configPath = path.join(repoRoot, "scripts/quality/config/quality-gate-config.json");

function countEffectiveLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function classifyFile(rel) {
  if (/(^|\/)tests\//.test(rel) || /\.(test|spec)\./.test(rel)) return "test";
  if (/\/page\.(ts|tsx|js|jsx)$/.test(rel)) return "page";
  if (rel.startsWith("packages/protocol/")) return "protocol";
  if (rel.startsWith("apps/companion/") && (rel.includes("/ui/") || rel.endsWith(".tsx"))) return "ui";
  if (rel.startsWith("apps/companion/")) return "companion";
  return "other";
}

function functionStarts(line) {
  return (
    /\bfunction\s+[A-Za-z0-9_$]+\s*\(/.test(line) ||
    /\b[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/.test(line) ||
    /\b[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?[A-Za-z0-9_$]+\s*=>\s*\{/.test(line)
  );
}

function braceDelta(line) {
  const withoutStrings = stripQuotedAndRegex(line);
  return (withoutStrings.match(/\{/g) ?? []).length - (withoutStrings.match(/\}/g) ?? []).length;
}

function stripQuotedAndRegex(text) {
  return text
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")
    .replace(/\/(?:\\.|[^/\r\n])+\/[dgimsuy]*/g, "");
}

function complexityOf(text) {
  const code = stripQuotedAndRegex(text);
  const branchWords = code.match(/\b(if|for|while|case|catch)\b/g) ?? [];
  const operators = code.match(/&&|\|\||\?\?|(?<![?:])\?(?![?.?])/g) ?? [];
  return 1 + branchWords.length + operators.length;
}

function collectFunctionMetrics(text) {
  const lines = text.split(/\r?\n/);
  const functions = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!functionStarts(lines[i])) continue;
    let depth = 0;
    let end = i;
    let sawOpen = false;
    for (let j = i; j < lines.length; j += 1) {
      depth += braceDelta(lines[j]);
      if (lines[j].includes("{")) sawOpen = true;
      if (sawOpen && depth <= 0) {
        end = j;
        break;
      }
    }
    const body = lines.slice(i, end + 1).join("\n");
    functions.push({
      line: i + 1,
      lines: countEffectiveLines(body),
      complexity: complexityOf(body)
    });
    i = Math.max(i, end);
  }
  return functions;
}

function isAllowedBarrel(rel, config) {
  if (config.allowedInternalBarrels?.includes(rel)) return true;
  const parts = rel.split("/");
  const parent = parts.at(-2) ?? "";
  return rel.endsWith("/index.tsx") && /^[A-Z][A-Za-z0-9]*$/.test(parent);
}

function responsibilityGroup(fileName) {
  const stem = fileName.replace(/\.(test|spec)?\.?(mjs|js|ts|tsx)$/, "");
  if (/docs?|layout/i.test(stem)) return "docs";
  if (/comment/i.test(stem)) return "comment";
  if (/struct|quality|gate/i.test(stem)) return "quality";
  if (/pair/i.test(stem)) return "pairing";
  if (/permission|auth/i.test(stem)) return "permission";
  if (/credential|secret|key/i.test(stem)) return "credential";
  if (/job|affair/i.test(stem)) return "job";
  if (/chat|message/i.test(stem)) return "chat";
  const match = stem.match(/^([a-z]+)/i);
  return match ? match[1].toLowerCase() : stem.slice(0, 6).toLowerCase();
}

async function analyzeDirectoryClustering(root, config) {
  const violations = [];
  const exclude = new Set(config.excludeDirNames ?? []);
  const roots = config.sourceRoots ?? [];
  const extensions = new Set(config.sourceExtensions ?? []);

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const files = entries
      .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name)))
      .map((entry) => entry.name);
    const subdirs = entries.filter((entry) => entry.isDirectory() && !exclude.has(entry.name));
    if (files.length >= 4 && subdirs.length === 0) {
      const groups = new Set(files.map(responsibilityGroup));
      if (groups.size >= 2) {
        const rel = toPosix(path.relative(root, dir));
        violations.push(
          violation(
            "STRUCT-004",
            rel,
            `目录含 ${files.length} 个源文件且职责组>=2（${[...groups].join(",")}）`,
            "按职责拆子目录，禁止长前缀代目录",
            { current: files.length, allowed: "clustered" },
          ),
        );
      }
    }
    for (const subdir of subdirs) {
      await walk(path.join(dir, subdir.name));
    }
  }

  for (const relRoot of roots) {
    const abs = path.join(root, relRoot);
    if (await exists(abs)) await walk(abs);
  }
  return violations;
}

function validateAllowlist(config) {
  const violations = [];
  const broad = [/^\*\*$/, /^\*\*\/\*$/, /^(apps|packages|src)\/\*\*$/];
  for (const entry of config.allowlist ?? []) {
    const target = String(entry.target ?? "");
    if (!entry.ruleId || !target || !entry.reason || !entry.owner || !entry.createdAt || !entry.exitCondition) {
      violations.push(
        violation("STRUCT-006", "scripts/quality/config/quality-gate-config.json", "豁免项缺少必需元数据", "补齐 ruleId/target/reason/owner/createdAt/exitCondition"),
      );
    }
    if (broad.some((item) => item.test(target))) {
      violations.push(
        violation("STRUCT-006", "scripts/quality/config/quality-gate-config.json", `拒绝大范围豁免：${target}`, "豁免必须指向精确文件或声明"),
      );
    }
  }
  return violations;
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

export async function runStructureGate(options = {}) {
  const root = options.root ?? repoRoot;
  const config = options.config ?? JSON.parse(await readFile(options.configPath ?? configPath, "utf8"));
  const violations = validateAllowlist(config);
  const files = await collectSourceFiles(root, config);

  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    const text = await readFile(file, "utf8");
    const kind = classifyFile(rel);
    const thresholds = config.thresholds[kind] ?? config.thresholds.other;
    const lineCount = countEffectiveLines(text);

    if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(rel) && !/(^|\/)tests\//.test(rel)) {
      violations.push(violation("STRUCT-001", rel, "测试文件与源码平放", "移入对应 tests/ 目录"));
    }
    if (/\/index\.(ts|tsx)$/.test(rel) && !isAllowedBarrel(rel, config)) {
      violations.push(violation("STRUCT-002", rel, "内部目录禁止 barrel index", "直引具体文件或仅保留包根公共门面"));
    }
    if (lineCount > thresholds.hardLines) {
      violations.push(violation("STRUCT-003", rel, `${kind} 文件超过硬上限`, "按职责拆分文件", { current: lineCount, allowed: thresholds.hardLines }));
    } else if (lineCount > thresholds.warnLines) {
      violations.push(violation("STRUCT-003", rel, `${kind} 文件超过告警线`, "尽快拆分，避免逼近硬上限", { severity: "warn", current: lineCount, allowed: thresholds.warnLines }));
    }

    for (const fn of collectFunctionMetrics(text)) {
      if (fn.lines > config.thresholds.function.hardLines) {
        violations.push(violation("STRUCT-005", rel, "函数超过硬上限", "拆出步骤函数或领域服务", { line: fn.line, current: fn.lines, allowed: config.thresholds.function.hardLines }));
      }
      if (fn.complexity > config.thresholds.complexity.hard) {
        violations.push(violation("STRUCT-007", rel, "函数复杂度超过硬上限", "用状态机、查表或早返回降低分支", { line: fn.line, current: fn.complexity, allowed: config.thresholds.complexity.hard }));
      }
    }
  }

  violations.push(...(await analyzeDirectoryClustering(root, config)));
  const bySeverity = splitBySeverity(violations);
  const passed = structurePasses(bySeverity, options.strict);
  return { ...bySeverity, violations, filesChecked: files.length, passed };
}

function structurePasses(result, strict) {
  return result.errors.length === 0 && (!strict || result.warnings.length === 0);
}

async function main() {
  const result = await runStructureGate({ strict: process.argv.includes("--strict") });
  printGateResult("check:structure", result);
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
