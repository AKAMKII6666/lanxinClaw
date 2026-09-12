/**
 * 工作区路径范围校验。
 *
 * 职责：判断候选路径是否落在已授权 workspaceRoot 内。
 * 不拥有：权限授予、OpenClaw 执行。
 * 纯函数：无 I/O。
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
 * 将运行时 workspaceHint 约束到授权根与桌面授权根。
 *
 * @param authorizedHint 权限请求里的 workspaceRoot；可空
 * @param runHint job 的 workspaceHint；可空
 * @param desktopRoot companion 桌面授权根；可空
 * @returns 授权范围内的绝对根，或越界失败
 */
export function resolveAuthorizedWorkspaceRoot(
  authorizedHint: string | null | undefined,
  runHint: string | null | undefined,
  desktopRoot?: string | null,
): { ok: true; workspaceRoot: string | null } | { ok: false; code: "workspace_scope_mismatch"; message: string } {
  const authorized = authorizedHint?.trim() || null;
  const run = runHint?.trim() || null;
  const desktop = desktopRoot?.trim() || null;

  const desktopCheck = validateDesktopScope(desktop, authorized, run);
  if (!desktopCheck.ok) {
    return desktopCheck;
  }

  if (!authorized) {
    return resolveWithoutAuthorizedHint(run, desktop);
  }
  return resolveWithAuthorizedHint(authorized, run);
}

/**
 * 校验路径是否落在桌面授权根内。
 *
 * @param desktop 桌面授权根
 * @param authorized 权限请求中的 workspaceRoot
 * @param run job 的工作区 hint
 * @returns 通过或越界
 */
function validateDesktopScope(
  desktop: string | null,
  authorized: string | null,
  run: string | null,
):
  | { ok: true }
  | { ok: false; code: "workspace_scope_mismatch"; message: string } {
  if (!desktop) {
    return { ok: true };
  }
  const desktopAbs = path.resolve(desktop);
  if (authorized && !isPathInsideOrEqual(desktopAbs, path.resolve(authorized))) {
    return scopeMismatch("proposedScope.workspaceRoot 超出桌面授权工作区");
  }
  if (run) {
    const runAbs = path.isAbsolute(run) ? path.normalize(run) : path.resolve(desktopAbs, run);
    if (!isPathInsideOrEqual(desktopAbs, runAbs)) {
      return scopeMismatch("job.workspaceHint 超出桌面授权工作区");
    }
  }
  return { ok: true };
}

/**
 * 无 proposedScope.workspaceRoot 时的解析。
 *
 * @param run job hint
 * @param desktop 桌面根
 * @returns 解析结果
 */
function resolveWithoutAuthorizedHint(
  run: string | null,
  desktop: string | null,
): { ok: true; workspaceRoot: string | null } {
  if (run && desktop) {
    const desktopAbs = path.resolve(desktop);
    const runAbs = path.isAbsolute(run) ? path.normalize(run) : path.resolve(desktopAbs, run);
    return { ok: true, workspaceRoot: runAbs };
  }
  return { ok: true, workspaceRoot: run ?? (desktop ? path.resolve(desktop) : null) };
}

/**
 * 有 proposedScope.workspaceRoot 时的解析。
 *
 * @param authorized 授权根
 * @param run job hint
 * @returns 解析结果
 */
function resolveWithAuthorizedHint(
  authorized: string,
  run: string | null,
): { ok: true; workspaceRoot: string | null } | { ok: false; code: "workspace_scope_mismatch"; message: string } {
  const authorizedRoot = path.resolve(authorized);
  if (!run) {
    return { ok: true, workspaceRoot: authorizedRoot };
  }
  const candidate = path.isAbsolute(run) ? path.normalize(run) : path.resolve(authorizedRoot, run);
  if (!isPathInsideOrEqual(authorizedRoot, candidate)) {
    return scopeMismatch("workspaceRoot 超出 permission.request 的 proposedScope.workspaceRoot");
  }
  return { ok: true, workspaceRoot: candidate };
}

/**
 * @param message 失败说明
 * @returns 越界失败
 */
function scopeMismatch(message: string): {
  ok: false;
  code: "workspace_scope_mismatch";
  message: string;
} {
  return { ok: false, code: "workspace_scope_mismatch", message };
}
