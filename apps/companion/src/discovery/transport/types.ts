/**
 * Discovery mDNS 传输抽象。
 *
 * 职责：隔离真实 Bonjour 与内存假传输，供 advertise / browse 注入。
 * 不拥有：广告字段语义校验、配对信任、权限裁决。
 * 副作用：真实实现会绑定组播套接字；内存实现仅改本地 Map。
 */

/** 已发布或已发现的 DNS-SD 服务快照 */
export interface MdnsServiceSnapshot {
  /** 实例名 */
  name: string;
  /** 服务短类型，如 lanxing-claw */
  type: string;
  /** tcp / udp */
  protocol: string;
  /** 服务端口 */
  port: number;
  /** 主机名（可空） */
  host?: string;
  /** TXT 键值；值均为字符串 */
  txt: Record<string, string>;
}

/** 发布句柄：可停止广告 */
export interface MdnsPublication {
  /** 停止本条广告 */
  stop: () => Promise<void>;
}

/** 浏览句柄：可停止浏览 */
export interface MdnsBrowserHandle {
  /** 停止浏览 */
  stop: () => Promise<void>;
}

/**
 * mDNS 传输端口。
 */
export interface MdnsTransport {
  /**
   * 发布服务。
   *
   * @param service 待发布快照
   * @returns 可停止的发布句柄
   */
  publish: (service: MdnsServiceSnapshot) => Promise<MdnsPublication>;

  /**
   * 浏览指定类型。
   *
   * @param type 服务短类型
   * @param protocol tcp/udp
   * @param onUp 发现回调
   * @param onDown 消失回调（可选）
   * @returns 浏览句柄
   */
  browse: (
    type: string,
    protocol: string,
    onUp: (service: MdnsServiceSnapshot) => void,
    onDown?: (service: MdnsServiceSnapshot) => void,
  ) => Promise<MdnsBrowserHandle>;

  /** 释放传输底层资源 */
  destroy: () => Promise<void>;
}
