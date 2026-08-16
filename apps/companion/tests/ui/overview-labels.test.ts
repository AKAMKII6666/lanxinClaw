/**
 * 总览状态标签映射单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLAW_CORE_STATUS_LABEL,
  CREDENTIAL_STATUS_LABEL,
  DEVICE_STATUS_LABEL,
  ZHANG_BOSS_STATUS_LABEL,
  labelOf,
} from "../../src/ui/pages/overview/overview-labels.js";

describe("overview status labels", () => {
  it("覆盖五卡关键状态文案", () => {
    assert.equal(labelOf(CLAW_CORE_STATUS_LABEL, "running"), "已运行");
    assert.equal(labelOf(CREDENTIAL_STATUS_LABEL, "synced"), "已同步");
    assert.equal(labelOf(DEVICE_STATUS_LABEL, "connected"), "已连接");
    assert.equal(labelOf(ZHANG_BOSS_STATUS_LABEL, "supervising"), "正在盯事务");
    assert.equal(labelOf(CLAW_CORE_STATUS_LABEL, "unknown_x"), "unknown_x");
  });
});
