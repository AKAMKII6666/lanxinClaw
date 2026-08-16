/**
 * 协议不透明 ID 生成。
 *
 * 职责：为 message / affair / job / pairing / session / permission 等实体生成稳定前缀 ID。
 * 不拥有：身份认证、配对证明、凭据或设备指纹存储。
 * 纯函数：仅使用运行时随机源，不读写磁盘或网络。
 */

/**
 * 取可用的 UUID；依赖 Web Crypto（Node 20+ / 现代浏览器均有）。
 *
 * @returns UUID 字符串
 */
function readRandomUuid(): string {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || typeof webCrypto.randomUUID !== "function") {
    throw new Error("当前运行时缺少 crypto.randomUUID，无法生成协议 ID");
  }
  return webCrypto.randomUUID();
}

/**
 * 生成带前缀的不透明 ID；UUID 仅作熵来源，不编码 secret。
 *
 * @param prefix 业务前缀，如 `msg`、`affair`
 * @returns `prefix_` + 去横线 UUID
 */
function createPrefixedId(prefix: string): string {
  return `${prefix}_${readRandomUuid().replaceAll("-", "")}`;
}

/**
 * 生成 envelope `messageId`。
 *
 * @returns 以 `msg_` 开头的不透明 ID
 */
export function createMessageId(): string {
  return createPrefixedId("msg");
}

/**
 * 生成 `affairId`。
 *
 * @returns 以 `affair_` 开头的不透明 ID
 */
export function createAffairId(): string {
  return createPrefixedId("affair");
}

/**
 * 生成 `jobId`。
 *
 * @returns 以 `job_` 开头的不透明 ID
 */
export function createJobId(): string {
  return createPrefixedId("job");
}

/**
 * 生成 `pairingId`。
 *
 * @returns 以 `pair_` 开头的不透明 ID
 */
export function createPairingId(): string {
  return createPrefixedId("pair");
}

/**
 * 生成 `sessionId`。
 *
 * @returns 以 `sess_` 开头的不透明 ID
 */
export function createSessionId(): string {
  return createPrefixedId("sess");
}

/**
 * 生成 `permissionRequestId`。
 *
 * @returns 以 `perm_` 开头的不透明 ID
 */
export function createPermissionRequestId(): string {
  return createPrefixedId("perm");
}

/**
 * 生成 chat 消息 ID。
 *
 * @returns 以 `chat_` 开头的不透明 ID
 */
export function createChatMessageId(): string {
  return createPrefixedId("chat");
}

/**
 * 生成 context attach ID。
 *
 * @returns 以 `attach_` 开头的不透明 ID
 */
export function createAttachId(): string {
  return createPrefixedId("attach");
}
