/**
 * Gateway hello-ok 能力解析。
 *
 * 职责：提取 features.methods/events，供探针选择使用。
 * 不拥有：连接握手、RPC 调用、状态裁决。
 * 纯函数：无 I/O。
 */

import type { OpenClawGatewayCapabilities } from "../../../../evidence/openclaw-execution-evidence.js";
import { readNumber, readRecord, readStringArray } from "../framing/readers.js";

/**
 * 提取 hello-ok 能力声明。
 *
 * @param payload connect 响应
 * @returns 能力快照
 */
export function readCapabilities(payload: Record<string, unknown>): OpenClawGatewayCapabilities {
  const features = readRecord(payload, ["features"]);
  const protocol = readNumber(payload, ["protocol"]);
  return {
    ...(protocol !== null ? { protocol } : {}),
    methods: readStringArray(features ?? payload, ["methods"]),
    events: readStringArray(features ?? payload, ["events"]),
  };
}
