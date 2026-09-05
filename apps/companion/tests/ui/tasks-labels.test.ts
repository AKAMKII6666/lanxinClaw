/**
 * 任务页标签与演示数据单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoTaskWorkspace, getDemoAffairDetail } from "../../src/ui/pages/tasks/tasks-demo.js";
import { AFFAIR_STATUS_LABEL, JOB_STATUS_LABEL, labelOf } from "../../src/ui/pages/tasks/tasks-labels.js";

describe("tasks page labels and demo", () => {
  it("区分 waiting_acceptance 与 closed，且 completed 不等于 closed", () => {
    assert.equal(labelOf(AFFAIR_STATUS_LABEL, "waiting_acceptance"), "待验收");
    assert.equal(labelOf(AFFAIR_STATUS_LABEL, "closed"), "已关闭");
    assert.equal(labelOf(JOB_STATUS_LABEL, "completed"), "执行已结束");
    assert.notEqual(labelOf(JOB_STATUS_LABEL, "completed"), labelOf(AFFAIR_STATUS_LABEL, "closed"));
  });

  it("演示工作区覆盖 running / blocked / waiting_acceptance", () => {
    const workspace = createDemoTaskWorkspace();
    const statuses = new Set(workspace.affairs.map((item) => item.status));
    assert.equal(statuses.has("running"), true);
    assert.equal(statuses.has("blocked"), true);
    assert.equal(statuses.has("waiting_acceptance"), true);
    const waiting = getDemoAffairDetail("affair_docs_review_001");
    assert.ok(waiting);
    assert.equal(waiting.status, "waiting_acceptance");
    assert.equal(waiting.currentJob?.status, "completed");
    assert.notEqual(waiting.status, "closed");
  });
});
