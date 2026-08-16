/**
 * 首次 Pairing 弹窗可用的安全视图模型。
 *
 * 职责：描述待确认配对请求的展示字段（指纹提示、双确认文案）。
 * 不拥有：pairing 状态机终裁、pairingSecret、发现传输。
 * 纯函数：仅类型；视图不得含 pairingSecret / 私钥。
 */

/**
 * 桌面侧待确认的首次配对请求摘要。
 */
export interface PendingPairingRequestView {
  /** 配对流程 id */
  pairingId: string;
  /** 电话设备 id */
  phoneDeviceId: string;
  /** 电话展示名 */
  phoneDisplayName: string;
  /** 截断设备指纹提示；不得是完整密钥 */
  fingerprintHint: string;
  /** 发现方式说明，如 LAN mDNS */
  discoveryMethodLabel: string;
  /** 当前 pairing 状态展示文案 */
  statusLabel: string;
  /** 主说明（不含凭据） */
  summary: string;
  /** 双确认提示文案 */
  dualConfirmHint: string;
}
