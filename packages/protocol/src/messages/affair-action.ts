/** 事务复合关闭合同。职责：声明命令和已提交结果；不拥有关闭裁决与 runtime。纯函数：仅类型声明。 */

/** 已认证 phone 或本地 UI 发起的关闭命令（协议 0.2）。 */
export interface AffairClosePayload {
  /** 目标事务，由请求方指定 */
  affairId: string;
  /** closed 为验收，canceled 为取消 */
  status: "closed" | "canceled";
  /** 请求方观察到的当前 execution job；null 表示尚未委派 */
  expectedCurrentJobId: string | null;
  /** 验收依据；closed 必填且非空 */
  acceptanceSummary?: string;
  /** 用户取消原因 */
  closeReason?: string;
}
