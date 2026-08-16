import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommentGate } from "../gates/comments/check-comments.mjs";
import { runDocsLayoutGate } from "../gates/docs/check-docs-layout.mjs";
import { runLanguageGate } from "../gates/language/check-language.mjs";
import { runStructureGate } from "../gates/structure/check-structure.mjs";

async function tempRepo() {
  return mkdtemp(path.join(os.tmpdir(), "lanxin-quality-"));
}

async function write(root, rel, text) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

test("docs layout rejects old English docs path", async () => {
  const root = await tempRepo();
  for (const rel of [
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
  ]) {
    await write(root, rel, "# ok\n");
  }
  await write(root, "docs/ai-owned/requirements.md", "# old\n");
  const result = await runDocsLayoutGate({ root });
  assert.ok(result.errors.some((item) => item.ruleId === "DOCS-LAYOUT-002"));
  assert.ok(result.errors.some((item) => item.ruleId === "DOCS-LAYOUT-005"));
});

test("docs layout allows version directory names", async () => {
  const root = await tempRepo();
  for (const rel of [
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
    "docs/共同维护/计划/v1.0/说明.md",
    "docs/共同维护/决议/说明.md",
    "docs/智能体维护/说明.md",
    "docs/智能体维护/项目地图.md"
  ]) {
    await write(root, rel, "# ok\n");
  }
  const result = await runDocsLayoutGate({ root });
  assert.equal(result.errors.length, 0);
});

test("structure gate rejects colocated tests and internal barrels", async () => {
  const root = await tempRepo();
  await write(root, "packages/protocol/src/messages/foo.test.ts", "export const ok = true;\n");
  await write(root, "packages/protocol/src/messages/index.ts", "export * from './foo';\n");
  const result = await runStructureGate({ root });
  assert.ok(result.errors.some((item) => item.ruleId === "STRUCT-001"));
  assert.ok(result.errors.some((item) => item.ruleId === "STRUCT-002"));
});

test("structure gate rejects flat mixed-responsibility directories", async () => {
  const root = await tempRepo();
  await write(root, "apps/companion/src/pairingServer.ts", "export const a = 1;\n");
  await write(root, "apps/companion/src/pairingStore.ts", "export const b = 1;\n");
  await write(root, "apps/companion/src/jobRunner.ts", "export const c = 1;\n");
  await write(root, "apps/companion/src/permissionDialog.ts", "export const d = 1;\n");
  const result = await runStructureGate({ root });
  assert.ok(result.errors.some((item) => item.ruleId === "STRUCT-004"));
});

test("comment gate rejects missing exported contract docs", async () => {
  const root = await tempRepo();
  await write(
    root,
    "packages/protocol/src/messages/create-affair.ts",
    "export interface CreateAffairMessage {\n  affairId: string;\n}\nexport function createMessage(affairId: string): CreateAffairMessage {\n  return { affairId };\n}\n",
  );
  const result = await runCommentGate({ root });
  assert.ok(result.errors.some((item) => item.ruleId === "COMMENT-001"));
  assert.ok(result.errors.some((item) => item.ruleId === "COMMENT-006"));
});

test("comment gate accepts documented exported contract", async () => {
  const root = await tempRepo();
  await write(
    root,
    "packages/protocol/src/messages/create-affair.ts",
    `/**
 * 职责：验证 create-affair message 的形状。
 * 不拥有 permission check 或 desktop execution。
 * 纯函数模块，无副作用。
 */
/**
 * 张老板把 affair mirror 到 companion 时发送的 message。
 */
export interface CreateAffairMessage {
  /** 电话侧 affair store 生成的 stable affair id。 */
  affairId: string;
}

/**
 * 创建测试用 create-affair message。
 * @param affairId 电话侧生成的 stable affair id。
 * @returns protocol layer 接受的 message payload。
 */
export function createMessage(affairId: string): CreateAffairMessage {
  return { affairId };
}
`,
  );
  const result = await runCommentGate({ root });
  assert.equal(result.errors.length, 0);
});

test("language gate rejects English prose docs", async () => {
  const root = await tempRepo();
  await write(root, "docs/共同维护/需求/坏例子.md", "This document is entirely written in English prose and should fail.\n");
  const result = await runLanguageGate({ root });
  assert.ok(result.errors.some((item) => item.ruleId === "LANG-001"));
});

test("language gate accepts Chinese prose with technical identifiers", async () => {
  const root = await tempRepo();
  await write(root, "docs/共同维护/需求/好例子.md", "这里允许保留 `affair.create`、OpenClaw、WebSocket 和 `jobId` 这些技术标识。\n");
  const result = await runLanguageGate({ root });
  assert.equal(result.errors.length, 0);
});

test("quality entry includes protocol and mock-companion tests", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const qualityPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../quality.mjs",
  );
  const text = await readFile(qualityPath, "utf8");
  assert.ok(text.includes("test:protocol"), "quality.mjs 须声明 test:protocol 步骤");
  assert.ok(text.includes("test:mock-companion"), "quality.mjs 须声明 test:mock-companion 步骤");
  assert.ok(text.includes("test:openclaw-adapter"), "quality.mjs 须声明 test:openclaw-adapter 步骤");
  assert.ok(text.includes("test:companion"), "quality.mjs 须声明 test:companion 步骤");
});
