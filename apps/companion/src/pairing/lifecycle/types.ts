/** 配对生命周期合同。职责：声明请求与决策类型；不拥有协议执行和凭据。纯函数：仅类型声明。 */
import {
type ProtocolEnvelope,
type ProtocolError
} from "@lanxin-claw/protocol";


/** 出站消息回调 */
export type EmitPairingEnvelope = (envelope: ProtocolEnvelope<any>) => void;

/** 配对处理成功 */
export interface PairingHandleOk {
  /** 成功标记 */
  ok: true;
  /** 配对完成时生成并交付给 phone 的共享秘密 */
  pairingSecret?: string;
}

/** 配对处理失败 */
export interface PairingHandleErr {
  /** 失败标记 */
  ok: false;
  /** 可经 wire 返回的协议错误；不得含凭据 */
  error: ProtocolError;
}

/** 处理结果 */
export type PairingHandleResult = PairingHandleOk | PairingHandleErr;

/** 生命周期依赖 */
export interface PairingLifecycleDeps {
  /** 桌面设备 id */
  desktopDeviceId: string;
  /** 桌面展示名 */
  desktopDisplayName: string;
  /** challenge 有效期毫秒，默认 5 分钟 */
  challengeTtlMs?: number;
  /** 时钟（可测） */
  now?: () => number;
}
