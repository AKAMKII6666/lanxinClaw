/**
 * 控制面板 UI 契约 contract：snapshot / queue / diagnostic 正反例。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  validateControlPanelSnapshot,
  validateDiagnosticReport,
  validateLastErrorSummary,
  validatePermissionQueue,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesRoot = path.resolve(here, "../../../examples");

/**
 * 读取 control-panel 示例。
 *
 * @param name 文件名
 * @returns 解析对象
 */
function readControlPanel(name: string): Record<string, unknown> {
  const text = readFileSync(path.join(examplesRoot, "control-panel", name), "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * 深拷贝 JSON 对象。
 *
 * @param value 源
 * @returns 副本
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("UI snapshot / queue / diagnostic contract", () => {
  it("正例：examples 全部通过对应 validator", () => {
    assert.equal(validateControlPanelSnapshot(readControlPanel("overview-snapshot.json")).ok, true);
    assert.equal(validatePermissionQueue(readControlPanel("permission-queue.json")).ok, true);
    assert.equal(validateDiagnosticReport(readControlPanel("diagnostic-report.json")).ok, true);
    assert.equal(validateLastErrorSummary(readControlPanel("last-error-summary.json")).ok, true);
  });

  it("反例：snapshot 缺 currentAffair 键 / 非法 companion.status", () => {
    const snap = clone(readControlPanel("overview-snapshot.json"));
    delete snap.currentAffair;
    assert.equal(validateControlPanelSnapshot(snap).ok, false);

    const badStatus = clone(readControlPanel("overview-snapshot.json"));
    (badStatus.companion as Record<string, unknown>).status = "healthy";
    assert.equal(validateControlPanelSnapshot(badStatus).ok, false);
  });

  it("反例：snapshot 根级不得携带凭据明文字段", () => {
    const snap = clone(readControlPanel("overview-snapshot.json"));
    snap.apiKey = "sk-should-never-appear";
    assert.equal(validateControlPanelSnapshot(snap).ok, false);

    const withToken = clone(readControlPanel("overview-snapshot.json"));
    withToken.token = "leak-token";
    assert.equal(validateControlPanelSnapshot(withToken).ok, false);
  });

  it("反例：permission queue pendingCount 非整数或非法 risk", () => {
    const queue = clone(readControlPanel("permission-queue.json"));
    queue.pendingCount = -1;
    assert.equal(validatePermissionQueue(queue).ok, false);

    const badRisk = clone(readControlPanel("permission-queue.json"));
    const items = badRisk.items as Array<Record<string, unknown>>;
    items[0].risk = "critical";
    assert.equal(validatePermissionQueue(badRisk).ok, false);
  });

  it("反例：diagnostic overallStatus 非法 / copyText 非字符串", () => {
    const report = clone(readControlPanel("diagnostic-report.json"));
    report.overallStatus = "fine";
    assert.equal(validateDiagnosticReport(report).ok, false);

    const badCopy = clone(readControlPanel("diagnostic-report.json"));
    badCopy.copyText = 123;
    assert.equal(validateDiagnosticReport(badCopy).ok, false);
  });

  it("反例：lastError 缺 occurredAt", () => {
    const err = clone(readControlPanel("last-error-summary.json"));
    delete err.occurredAt;
    assert.equal(validateLastErrorSummary(err).ok, false);
  });
});
