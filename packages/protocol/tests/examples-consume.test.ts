/**
 * 协议 examples 消费测试：仓库根 examples/ 正例须通过 validators。
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createEnvelope,
  createMessageId,
  schemaFileForMessageType,
  validateControlPanelSnapshot,
  validateDiagnosticReport,
  validateLastErrorSummary,
  validateMessage,
  validatePermissionQueue,
  type MessageType,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const examplesRoot = path.join(repoRoot, "examples");

/**
 * 读取 JSON 文件。
 *
 * @param rel 相对 examples 根的路径
 * @returns 解析后的值
 */
function readExample(rel: string): unknown {
  const text = readFileSync(path.join(examplesRoot, rel), "utf8");
  return JSON.parse(text) as unknown;
}

/**
 * 递归收集 .json 示例路径。
 *
 * @param dir 绝对目录
 * @param prefix 相对前缀
 * @returns 相对 examples 的路径列表
 */
function listJsonFiles(dir: string, prefix = ""): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listJsonFiles(path.join(dir, entry.name), rel));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(rel);
    }
  }
  return files;
}

describe("@lanxin-claw/protocol examples consume", () => {
  it("envelope examples 通过 validateMessage", () => {
    const envelopeFiles = listJsonFiles(examplesRoot).filter((rel) =>
      rel.endsWith(".envelope.json"),
    );
    assert.ok(envelopeFiles.length >= 6, "应至少有若干 envelope 正例");
    for (const rel of envelopeFiles) {
      const result = validateMessage(readExample(rel));
      assert.equal(result.ok, true, `${rel} 应通过: ${result.ok ? "" : result.error.message}`);
    }
  });

  it("控制面板 examples 通过对应 UI validators", () => {
    const snapshot = validateControlPanelSnapshot(readExample("control-panel/overview-snapshot.json"));
    assert.equal(snapshot.ok, true, snapshot.ok ? "" : snapshot.error.message);

    const queue = validatePermissionQueue(readExample("control-panel/permission-queue.json"));
    assert.equal(queue.ok, true, queue.ok ? "" : queue.error.message);

    const report = validateDiagnosticReport(readExample("control-panel/diagnostic-report.json"));
    assert.equal(report.ok, true, report.ok ? "" : report.error.message);

    const lastError = validateLastErrorSummary(readExample("control-panel/last-error-summary.json"));
    assert.equal(lastError.ok, true, lastError.ok ? "" : lastError.error.message);
  });

  it("拒绝非法 envelope", () => {
    const bad = validateMessage({
      protocolVersion: "0.1",
      messageId: "msg_bad",
      sentAt: "2026-07-22T00:00:00.000Z",
      source: { kind: "phone", deviceId: "p1" },
      target: { kind: "companion", deviceId: "d1" },
      type: "affair.create",
      payload: { title: "missing required fields" },
    });
    assert.equal(bad.ok, false);
  });

  it("createEnvelope 生成可校验消息（配合合法 payload）", () => {
    const payload = {
      affairId: "affair_test_001",
      title: "测试事务",
      ownerAgent: "zhang-boss" as const,
      status: "ready" as const,
      context: ["ctx"],
      acceptanceCriteria: ["ok"],
      blockedReason: null,
      resumeCondition: null,
      currentJobId: null,
    };
    const envelope = createEnvelope({
      messageId: createMessageId(),
      source: { kind: "phone", deviceId: "phone_1" },
      target: { kind: "companion", deviceId: "desktop_1" },
      type: "affair.create",
      payload,
      sentAt: "2026-07-23T00:00:00.000Z",
    });
    const result = validateMessage(envelope);
    assert.equal(result.ok, true, result.ok ? "" : result.error.message);
  });

  it("schema 登记覆盖已知 message type", () => {
    const type: MessageType = "job.completed";
    assert.equal(schemaFileForMessageType(type), "job.schema.json");
  });
});
