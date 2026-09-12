/** 事务关闭命令校验。职责：验证目标、当前 job 与验收摘要；不拥有状态转移。纯函数：无 I/O。 */
import type { AffairClosePayload } from "../../../messages/affair-action.js";
import { validationFailed } from "../../../errors/protocol-error.js";
import type { ValidateResult } from "../../result.js";

/**
 * 拒绝完整事务快照和缺失验收依据的关闭命令。
 * @param value 请求载荷
 * @returns 校验结果
 */
export function validateAffairClosePayload(value: unknown): ValidateResult<AffairClosePayload> {
  const fail = (): ValidateResult<AffairClosePayload> => ({
    ok: false, error: validationFailed("affair.close 必须包含明确事务、预期 job 和关闭依据"),
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const obj = value as Record<string, unknown>;
  const keys = ["affairId", "status", "expectedCurrentJobId", "acceptanceSummary", "closeReason"];
  if (Object.keys(obj).some((key) => !keys.includes(key))) return fail();
  if (!isNonEmptyText(obj.affairId)) return fail();
  if (obj.status !== "closed" && obj.status !== "canceled") return fail();
  if (obj.expectedCurrentJobId !== null &&
      !isNonEmptyText(obj.expectedCurrentJobId)) return fail();
  for (const key of ["acceptanceSummary", "closeReason"]) {
    if (key in obj && !isNonEmptyText(obj[key])) return fail();
  }
  if (obj.status === "closed" && !obj.acceptanceSummary) return fail();
  return { ok: true, value: obj as unknown as AffairClosePayload };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
