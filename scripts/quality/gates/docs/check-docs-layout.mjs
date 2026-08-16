import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, listDirs, toPosix, walkFiles } from "../../lib/paths.mjs";
import { printGateResult, splitBySeverity, violation } from "../../lib/report.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const REQUIRED_FILES = [
  "AGENTS.md",
  "docs/人类维护/说明.md",
  "docs/共同维护/说明.md",
  "docs/共同维护/需求/说明.md",
  "docs/共同维护/需求/00-产品简述.md",
  "docs/共同维护/技术设计/说明.md",
  "docs/共同维护/技术设计/目录落点.md",
  "docs/共同维护/技术设计/语言规范.md",
  "docs/共同维护/技术设计/质量门禁.md",
  "docs/共同维护/技术设计/协议/说明.md",
  "docs/共同维护/计划/说明.md",
  "docs/共同维护/决议/说明.md",
  "docs/智能体维护/说明.md",
  "docs/智能体维护/项目地图.md"
];

const FORBIDDEN_FILES = [
  "docs/ai-owned/requirements.md",
  "docs/ai-owned/security-model.md",
  "docs/ai-owned/openclaw-integration.md",
  "docs/ai-owned/coding-style.md",
  "docs/ai-owned/roadmap.md"
];

const DOCS_ROOT_DIRS = new Set(["人类维护", "共同维护", "智能体维护"]);
const SHARED_DIRS = new Set(["需求", "技术设计", "计划", "决议"]);

async function collectMarkdownLinks(root) {
  const files = await walkFiles(path.join(root, "docs"), {
    extensions: new Set([".md"]),
    excludeDirNames: new Set(["node_modules", ".git"])
  });
  const links = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const rel = toPosix(path.relative(root, file));
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRe.exec(text))) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      links.push({ file: rel, target: target.split("#")[0] });
    }
  }
  return links;
}

async function checkLinks(root) {
  const violations = [];
  const links = await collectMarkdownLinks(root);
  for (const link of links) {
    if (!link.target || link.target.startsWith("<")) continue;
    const base = path.dirname(path.join(root, link.file));
    const resolved = path.resolve(base, link.target);
    if (!resolved.startsWith(root)) continue;
    if (!(await exists(resolved))) {
      violations.push(
        violation(
          "DOCS-LAYOUT-004",
          link.file,
          `文档链接不存在：${link.target}`,
          "修正链接或补齐目标文档",
        ),
      );
    }
  }
  return violations;
}

function hasChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function isAllowedVersionSegment(text) {
  return /^v\d+(?:\.\d+)*$/.test(text);
}

async function checkDocsPathNames(root) {
  const files = await walkFiles(path.join(root, "docs"), {
    extensions: new Set([".md", ".mdc"]),
    excludeDirNames: new Set(["node_modules", ".git"])
  });
  const violations = [];
  const seenSegments = new Set();

  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    const segments = rel.split("/").slice(1);
    for (const segment of segments) {
      const base = segment.replace(/\.mdc?$/, "");
      const key = `${rel}:${segment}`;
      if (seenSegments.has(key)) continue;
      seenSegments.add(key);
      if (!hasChinese(base) && !isAllowedVersionSegment(base)) {
        violations.push(
          violation(
            "DOCS-LAYOUT-005",
            rel,
            `docs 路径段不是中文：${segment}`,
            "docs 下目录和文件名必须使用中文；版本号目录允许使用 v1.0 这类格式，专业名词写在正文里",
          ),
        );
      }
    }
  }

  return violations;
}

export async function runDocsLayoutGate(options = {}) {
  const root = options.root ?? repoRoot;
  const violations = [];

  for (const rel of REQUIRED_FILES) {
    if (!(await exists(path.join(root, rel)))) {
      violations.push(
        violation("DOCS-LAYOUT-001", rel, "缺少必需文档", "补齐文档分层入口"),
      );
    }
  }

  for (const rel of FORBIDDEN_FILES) {
    if (await exists(path.join(root, rel))) {
      violations.push(
        violation("DOCS-LAYOUT-002", rel, "旧英文文档位置仍存在", "迁入 docs/共同维护 或 docs/智能体维护 对应分册"),
      );
    }
  }

  for (const name of await listDirs(path.join(root, "docs"))) {
    if (!DOCS_ROOT_DIRS.has(name)) {
      violations.push(
        violation("DOCS-LAYOUT-003", `docs/${name}`, "docs 顶层目录未登记", "只使用 人类维护/共同维护/智能体维护"),
      );
    }
  }

  for (const name of await listDirs(path.join(root, "docs", "共同维护"))) {
    if (!SHARED_DIRS.has(name)) {
      violations.push(
        violation("DOCS-LAYOUT-003", `docs/共同维护/${name}`, "共同维护子目录未登记", "只使用 需求/技术设计/计划/决议"),
      );
    }
  }

  violations.push(...(await checkLinks(root)));
  violations.push(...(await checkDocsPathNames(root)));
  const bySeverity = splitBySeverity(violations);
  return { ...bySeverity, violations, filesChecked: REQUIRED_FILES.length };
}

async function main() {
  const result = await runDocsLayoutGate();
  printGateResult("check:docs-layout", result);
  if (result.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
