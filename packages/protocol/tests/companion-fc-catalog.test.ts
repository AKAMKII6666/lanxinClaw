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
  it("导出稳定 FC 名且与 catalog 一一对应", () => {
    assert.equal(COMPANION_FC_NAMES.length, 16);
    assert.equal(COMPANION_FC_CATALOG.length, COMPANION_FC_NAMES.length);
    for (const name of COMPANION_FC_NAMES) {
      assert.equal(isCompanionFcName(name), true);
      const mapping = getCompanionFcMapping(name);
      assert.ok(mapping);
      assert.equal(mapping?.name, name);
    }
  });

  it("emits 仅含已知 type；查询无需 session，消费后可异步补回执", () => {
    const localOnly = COMPANION_FC_CATALOG.filter((item) => item.localOnly);
    assert.deepEqual(
      localOnly.map((item) => item.name).sort(),
      [
        "companion.bind_message",
        "companion.discover_desktops",
        "companion.fetch_pending_context",
        "companion.get_connection_status",
        "companion.get_progress",
        "companion.prepare_desktop_connection",
      ],
    );
    for (const item of COMPANION_FC_CATALOG) {
      for (const type of item.emits) {
        assert.equal(isMessageType(type), true, `非法 emit: ${type}`);
      }
      if (item.name === "companion.fetch_pending_context") {
        assert.deepEqual(item.emits, ["chat.read_receipt"]);
      } else if (item.localOnly) {
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
    const acceptAffair = getCompanionFcMapping("companion.accept_affair");
    assert.ok(acceptAffair?.emits.includes("affair.close"));
    assert.equal(acceptAffair?.summary.includes("用户明确验收"), true);
    const createJob = getCompanionFcMapping("companion.create_job");
    assert.equal(createJob?.emits.includes("affair.create"), true);
    assert.equal(createJob?.emits.includes("affair.close"), false);
  });
});
