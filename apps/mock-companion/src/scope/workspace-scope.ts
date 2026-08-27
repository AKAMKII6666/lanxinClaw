/**
 * mock 工作区 scope 校验（与 companion workspace-scope 同语义）。
 */

import path from "node:path";

/**
 * 候选路径是否等于授权根或其子路径。
 *
 * @param base 授权根
 * @param candidate 候选路径
 * @returns 是否在范围内
 */
export function isPathInsideOrEqual(base: string, candidate: string): boolean {
  const rel = path.relative(base, candidate);
  if (!rel) {
    return true;
  }
  if (path.isAbsolute(rel)) {
    return false;
  }
  return rel.split(/[/\\]/)[0] !== "..";
}

/**
 * grant 前校验 proposedScope 是否在 mock 授权根内。
 *
 * @param workspaceRoot 权限请求中的 workspaceRoot
 * @param authorizedRoot mock 桌面授权根
 * @returns 是否通过
 */
export function validateMockWorkspaceScope(
  workspaceRoot: string | undefined,
  authorizedRoot: string,
): boolean {
  if (!workspaceRoot?.trim()) {
    return true;
  }
  return isPathInsideOrEqual(path.resolve(authorizedRoot), path.resolve(workspaceRoot));
}
