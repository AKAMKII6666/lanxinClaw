/**
 * 诊断页标签与演示报告单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIAGNOSTICS_RESTART_COMPANION_ACTION } from "../../src/ui/pages/diagnostics/diagnostics-bridge-actions.js";
import { createDemoDiagnosticReport } from "../../src/ui/pages/diagnostics/diagnostics-demo.js";
import {
  OVERALL_STATUS_LABEL,
  PROBE_STATUS_LABEL,
  labelOf,
} from "../../src/ui/pages/diagnostics/diagnostics-labels.js";

describe("diagnostics page views", () => {
  it("标签覆盖 probe 与 overall 状态", () => {
    assert.equal(labelOf(PROBE_STATUS_LABEL, "ok"), "正常");
    assert.equal(labelOf(PROBE_STATUS_LABEL, "warn"), "警告");
    assert.equal(labelOf(OVERALL_STATUS_LABEL, "warn"), "存在警告");
  });

  it("「重启 Companion」绑定 companion.restart，而非 clawCore.restart", () => {
    assert.equal(DIAGNOSTICS_RESTART_COMPANION_ACTION.type, "companion.restart");
    assert.notEqual(DIAGNOSTICS_RESTART_COMPANION_ACTION.type, "clawCore.restart");
  });

  it("演示报告含服务/环境 probe、LAN/firewall 与可复制摘要且无凭据明文", () => {
    const report = createDemoDiagnosticReport();
    assert.ok(report.services.some((item) => item.probeId === "credential.api"));
    assert.ok(report.environment.some((item) => item.probeId === "net.lan_discovery"));
    assert.ok(report.environment.some((item) => item.probeId === "net.firewall"));
    assert.ok(report.copyText.includes("lan_discovery=warn"));
    assert.equal(report.lastError?.code, "job.blocked");
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("sk-"), false);
    assert.equal(serialized.includes("pairingSecret"), false);
    assert.equal(serialized.includes("API_KEY="), false);
  });
});
