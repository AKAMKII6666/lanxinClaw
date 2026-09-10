/** 精确关联回执正反例，特别禁止无提交事实的 affair.close 成功。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PROTOCOL_VERSION, validateProtocolResultAck } from "../src/index.js";

test("成功与失败回执都必须具备版本、请求关联和类型", () => {
  const success = { protocolVersion: PROTOCOL_VERSION, ok: true, correlationId: "msg_a", acceptedType: "job.create" };
  assert.equal(validateProtocolResultAck(success).ok, true);
  for (const key of ["protocolVersion", "correlationId", "acceptedType"]) {
    const incomplete: Record<string, unknown> = { ...success }; delete incomplete[key];
    assert.equal(validateProtocolResultAck(incomplete).ok, false);
  }
  assert.equal(validateProtocolResultAck({ ...success, acceptedType: "affair.close" }).ok, false);
  assert.equal(validateProtocolResultAck({ protocolVersion: PROTOCOL_VERSION, ok: false, correlationId: "msg_a", rejectedType: "job.create",
    error: { code: "permission_denied", message: "权限不足", retryable: false } }).ok, true);
});

test("关闭结果必须是同一事务的完整事实", () => {
  const affair = { affairId: "aff_a", title: "检查", ownerAgent: "zhang-boss", status: "closed", context: [], acceptanceCriteria: [], currentJobId: "job_a" };
  const job = { jobId: "job_a", affairId: "aff_a", executor: "openclaw", status: "completed", goal: "检查", evidenceQuality: "present", resultDigest: "共 3 个文件", allowedPermissions: ["workspace.read"] };
  const success = { protocolVersion: PROTOCOL_VERSION, ok: true, correlationId: "msg_a", acceptedType: "affair.close", result: { affair, jobs: [job] } };
  assert.equal(validateProtocolResultAck(success).ok, true);
  assert.equal(validateProtocolResultAck({ ...success, result: { affair, jobs: [{ ...job, affairId: "aff_b" }] } }).ok, false);
});
