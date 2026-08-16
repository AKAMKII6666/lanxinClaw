/**
 * 已配对设备身份记录的形状。
 *
 * 职责：描述 companion 本地持久化的 device identity 字段。
 * 不拥有：配对状态机、session 传输、OS keychain 具体实现、执行权限。
 * 纯函数：仅类型；pairingSecret 不得写入日志或仓库示例。
 */

/**
 * 本地 identity 生命周期标记。
 */
export type DeviceIdentityLifecycle = "active" | "revoked";

/**
 * 已配对设备身份；用于重连认证与 revoke。
 */
export interface DeviceIdentityRecord {
  /** 配对流程 id；revoke 后仍可保留审计关联 */
  pairingId: string;
  /** 电话设备 id；认证主键之一 */
  phoneDeviceId: string;
  /** 电话展示名；可空展示，不参与认证 */
  phoneDisplayName: string;
  /** 桌面设备 id；认证主键之一 */
  desktopDeviceId: string;
  /** 桌面展示名 */
  desktopDisplayName: string;
  /**
   * 配对共享秘密；仅 active 时非空。
   * 用于构造 session.open 的 authProof；不得记入审计明文。
   */
  pairingSecret: string | null;
  /** 本地生命周期；revoked 后不得接受重连 */
  lifecycle: DeviceIdentityLifecycle;
  /** 配对完成时间 ISO-8601 */
  pairedAt: string;
  /** 撤销时间；未撤销为 null */
  revokedAt: string | null;
  /** 撤销原因；未撤销为 null */
  revokeReason: string | null;
}
