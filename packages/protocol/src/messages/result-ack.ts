/**
 * 请求结果回执合同。
 * 职责：精确关联请求和提交结果；不拥有事务提交、认证或重试。纯类型定义。
 */
import type { ProtocolVersion } from "../protocol-version.js";
import type { ProtocolError } from "../errors/protocol-error.js";
import type { AffairPayload, JobPayload } from "./payloads/core.js";

/** 关闭动作已提交的业务事实，不能以发送成功代替。 */
export interface AffairActionResult {
  /** 已提交事务 */
  affair: AffairPayload;
  /** 该动作涉及的当前子任务事实 */
  jobs: JobPayload[];
}

/** 请求处理成功，含重复请求的原提交结果。 */
export interface ProtocolAckSuccess {
  /** 当前协议版本 */
  protocolVersion: ProtocolVersion;
  /** 业务处理成功 */
  ok: true;
  /** 原请求 messageId */
  correlationId: string;
  /** 原请求类型 */
  acceptedType: string;
  /** 是否复用先前提交结果 */
  duplicate?: boolean;
  /** 关闭动作提交的完整事实 */
  result?: AffairActionResult;
}

/** 请求拒绝；无法解析的帧没有可信请求标识。 */
export interface ProtocolAckFailure {
  /** 当前协议版本 */
  protocolVersion: ProtocolVersion;
  /** 未成功提交 */
  ok: false;
  /** 原请求 messageId；不可识别时为 null */
  correlationId: string | null;
  /** 原请求类型；不可识别时为 null */
  rejectedType: string | null;
  /** 稳定失败原因 */
  error: ProtocolError;
}

/** JSON 回执不是业务 envelope，其 correlationId 必须匹配本次请求。 */
export type ProtocolResultAck = ProtocolAckSuccess | ProtocolAckFailure;
