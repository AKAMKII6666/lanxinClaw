/**
 * companion FC catalog contract：名称稳定、映射合法、禁止 completed→closed 捷径。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPANION_FC_CATALOG,
  COMPANION_FC_NAMES,
  getCompanionFcMapping,
  isCompanionFcName,
  isMessageType,
} from "../src/index.js";

describe("companion FC catalog", () => {
  it("导出八个稳定 FC 名且与 catalog 一一对应", () => {
    assert.equal(COMPANION_FC_NAMES.length, 8);
    assert.equal(COMPANION_FC_CATALOG.length, COMPANION_FC_NAMES.length);
    for (const name of COMPANION_FC_NAMES) {
      assert.equal(isCompanionFcName(name), true);
      const mapping = getCompanionFcMapping(name);
      assert.ok(mapping);
      assert.equal(mapping?.name, name);
    }
  });

  it("emits 仅含已知 message type；查询类为空", () => {
    const localOnly = COMPANION_FC_CATALOG.filter((item) => item.localOnly);
    assert.deepEqual(
      localOnly.map((item) => item.name).sort(),
      ["companion.fetch_pending_context", "companion.get_progress"],
    );
    for (const item of COMPANION_FC_CATALOG) {
      for (const type of item.emits) {
        assert.equal(isMessageType(type), true, `非法 emit: ${type}`);
      }
      if (item.localOnly) {
        assert.equal(item.emits.length, 0);
      }
    }
  });

  it("未知名返回 null；catalog 不含把 completed 写成 closed 的 FC", () => {
    assert.equal(getCompanionFcMapping("companion.execute_arbitrary"), null);
    assert.equal(isCompanionFcName("companion.close_on_completed"), false);
    for (const item of COMPANION_FC_CATALOG) {
      assert.equal(item.emits.includes("affair.close") && item.name === "companion.create_job", false);
    }
    const cancelAffair = getCompanionFcMapping("companion.cancel_affair");
    assert.ok(cancelAffair?.emits.includes("affair.close"));
    assert.equal(cancelAffair?.summary.includes("不是验收通过"), true);
    const createJob = getCompanionFcMapping("companion.create_job");
    assert.equal(createJob?.emits.includes("affair.close"), false);
  });
});
