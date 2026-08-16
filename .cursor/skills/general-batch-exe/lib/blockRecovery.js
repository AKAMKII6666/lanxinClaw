'use strict';

/**
 * Module: blockRecovery
 * Purpose: Validate blocker-analysis reports and enforce recovery scope.
 *
 * Agents diagnose and propose paths; this module owns the final policy decision.
 * It deliberately uses only project-local paths and never grants OS-level access.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RECOVERABLE_KINDS = new Set([
  'INDEX_SCHEMA_CORRUPTION',
  'HARD_STOP_FALSE_POSITIVE',
  'FIXER_ACCUMULATION',
  'IN_SCOPE_VERIFY',
  'PROJECT_DEPENDENCY_MISSING',
]);

const HUMAN_KINDS = new Set([
  'OUT_OF_SCOPE_MODULE',
  'EXTERNAL_ENVIRONMENT',
  'GBX_INTERNAL_FAILURE',
  'AUTH_OR_SECRET_REQUIRED',
  'UNKNOWN',
]);

const CONFIDENCE = Object.freeze({ low: 0, medium: 1, high: 2 });

function createRecoveryRunId(prefix = 'block-analysis') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function clearFile(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function normalizeRelative(workdir, candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  const absolute = path.resolve(workdir, candidate);
  const relative = path.relative(workdir, absolute);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

function globToRegExp(pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/').replace(/^\.\//, '');
  let source = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === '*' && normalized[i + 1] === '*') {
      source += '.*';
      i += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}(?:/.*)?$`);
}

function pathMatches(candidate, patterns) {
  return (patterns || []).some((pattern) => globToRegExp(pattern).test(candidate));
}

function humanReason(report) {
  const root = report && report.rootCause ? report.rootCause : '阻断原因无法安全自动判定';
  if (report && report.kind === 'OUT_OF_SCOPE_MODULE') {
    const targets = (report.requiredPaths || []).join(', ') || '未声明模块';
    return `无法解决block,原因是${root}，但要解决需要动到无关模块${targets}，请人类评审`;
  }
  if (
    report &&
    (report.kind === 'EXTERNAL_ENVIRONMENT' ||
      report.kind === 'AUTH_OR_SECRET_REQUIRED')
  ) {
    return `无法解决block,原因是${root}，但要解决需要修改项目目录外环境或提供授权，请人类评审`;
  }
  if (report && report.kind === 'GBX_INTERNAL_FAILURE') {
    return `无法解决block,原因是${root}，但要解决需要修改gbx自身，请人类评审`;
  }
  return `无法解决block,原因是${root}，自动恢复策略无法证明修改安全，请人类评审`;
}

function collectDeclaredScope(config, activeTaskIds) {
  const scopes =
    config && config.block_recovery && config.block_recovery.task_scopes
      ? config.block_recovery.task_scopes
      : {};
  const patterns = [];
  let declared = false;
  for (const id of activeTaskIds || []) {
    const scope = scopes[id];
    if (!scope || typeof scope !== 'object') continue;
    declared = true;
    patterns.push(...(scope.allowed_paths || []), ...(scope.related_paths || []));
  }
  return { declared, patterns };
}

function evaluateBlockAnalysis({
  report,
  analysisRunId,
  config,
  workdir,
  activeTaskIds = [],
  skillRoot,
}) {
  const recovery = config.block_recovery || {};
  if (!report || typeof report !== 'object') {
    return { ok: false, reason: '阻断分析报告缺失或不是有效 JSON' };
  }
  if (
    report.schemaVersion !== 1 ||
    report.role !== 'block-analyzer' ||
    report.analysisRunId !== analysisRunId
  ) {
    return { ok: false, reason: '阻断分析报告不是当前分析轮次生成' };
  }
  const allKinds = new Set([...RECOVERABLE_KINDS, ...HUMAN_KINDS]);
  if (!allKinds.has(report.kind)) {
    return { ok: false, reason: `阻断分析报告含未知 kind: ${report.kind || '(missing)'}` };
  }
  if (
    typeof report.rootCause !== 'string' ||
    report.rootCause.trim() === '' ||
    typeof report.scopeEvidence !== 'string' ||
    !Array.isArray(report.requiredPaths) ||
    report.requiredPaths.some(
      (candidate) => typeof candidate !== 'string' || candidate.trim() === '',
    ) ||
    typeof report.touchesGbx !== 'boolean' ||
    typeof report.touchesExternalSystem !== 'boolean' ||
    !['none', 'install_declared'].includes(report.dependencyAction)
  ) {
    return { ok: false, reason: '阻断分析报告字段缺失或类型无效' };
  }
  if (report.recoverable !== true) {
    return { ok: false, human: true, reason: humanReason(report), report };
  }
  if (!RECOVERABLE_KINDS.has(report.kind)) {
    return { ok: false, human: true, reason: humanReason(report), report };
  }
  if (!(recovery.allowed_kinds || []).includes(report.kind)) {
    return {
      ok: false,
      human: true,
      reason: `无法解决block,原因是恢复类型 ${report.kind} 未被当前策略允许，请人类评审`,
      report,
    };
  }
  const minimum = CONFIDENCE[recovery.min_confidence] ?? CONFIDENCE.high;
  if ((CONFIDENCE[report.confidence] ?? -1) < minimum) {
    return {
      ok: false,
      human: true,
      reason: `无法解决block,原因是自动分析置信度不足（${report.confidence || 'missing'}），请人类评审`,
      report,
    };
  }
  if (report.touchesGbx === true) {
    return {
      ok: false,
      human: true,
      reason: humanReason({ ...report, kind: 'GBX_INTERNAL_FAILURE' }),
      report,
    };
  }
  if (report.touchesExternalSystem === true) {
    return {
      ok: false,
      human: true,
      reason: humanReason({ ...report, kind: 'EXTERNAL_ENVIRONMENT' }),
      report,
    };
  }
  if (
    report.dependencyAction &&
    report.dependencyAction !== 'none' &&
    recovery.dependency_policy === 'none'
  ) {
    return {
      ok: false,
      human: true,
      reason: '无法解决block,原因是修复需要安装依赖，但当前恢复策略禁止依赖安装，请人类评审',
      report,
    };
  }
  if (
    report.dependencyAction === 'install_declared' &&
    !(report.requiredPaths || []).some((candidate) =>
      /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(
        candidate,
      ),
    )
  ) {
    return {
      ok: false,
      human: true,
      reason: '无法解决block,原因是依赖恢复未声明项目 manifest/lockfile 路径，请人类评审',
      report,
    };
  }

  const requiredPaths = [];
  for (const candidate of report.requiredPaths || []) {
    const normalized = normalizeRelative(workdir, candidate);
    if (!normalized) {
      return {
        ok: false,
        human: true,
        reason: `无法解决block,原因是修复路径位于项目目录外或无效：${candidate}，请人类评审`,
        report,
      };
    }
    requiredPaths.push(normalized);
  }
  if (requiredPaths.length === 0) {
    return { ok: false, reason: '可恢复的阻断分析必须声明 requiredPaths' };
  }

  const skillRelative = skillRoot ? normalizeRelative(workdir, skillRoot) : null;
  const denied = [...(recovery.deny_paths || [])];
  if (skillRelative) denied.push(`${skillRelative}/**`);
  const deniedPath = requiredPaths.find((candidate) => pathMatches(candidate, denied));
  if (deniedPath) {
    return {
      ok: false,
      human: true,
      reason: `无法解决block,原因是修复需要修改禁止路径 ${deniedPath}，请人类评审`,
      report,
    };
  }

  const declaredScope = collectDeclaredScope(config, activeTaskIds);
  if (declaredScope.declared) {
    const outside = requiredPaths.find(
      (candidate) => !pathMatches(candidate, declaredScope.patterns),
    );
    if (outside) {
      return {
        ok: false,
        human: true,
        reason: `无法解决block,原因是修复需要修改本任务未声明的模块 ${outside}，请人类评审`,
        report,
      };
    }
  } else if (recovery.require_declared_scope === true) {
    return {
      ok: false,
      human: true,
      reason: '无法解决block,原因是当前任务没有声明自动恢复范围，请人类评审',
      report,
    };
  }

  return { ok: true, report: { ...report, requiredPaths } };
}

function listProjectFiles(workdir) {
  try {
    const stdout = execFileSync(
      'git',
      ['ls-files', '-co', '--exclude-standard', '-z'],
      { cwd: workdir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return stdout.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function captureProjectSnapshot(workdir, ignoredPatterns = []) {
  const snapshot = {};
  for (const rel of listProjectFiles(workdir)) {
    const normalized = rel.replace(/\\/g, '/');
    if (pathMatches(normalized, ignoredPatterns)) continue;
    const absolute = path.join(workdir, rel);
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile()) continue;
      snapshot[normalized] = crypto
        .createHash('sha1')
        .update(fs.readFileSync(absolute))
        .digest('hex');
    } catch {
      // A concurrently removed file is represented as absent in this snapshot.
    }
  }
  return snapshot;
}

function changedPaths(before, after) {
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}

function evaluateRepairChanges({
  changed,
  approvedPaths,
  workflowDir,
}) {
  const allowed = [...(approvedPaths || [])];
  const ignored = workflowDir ? [`${workflowDir}/**`] : [];
  const outside = (changed || []).filter(
    (candidate) =>
      !pathMatches(candidate, ignored) && !pathMatches(candidate, allowed),
  );
  if (outside.length) {
    return {
      ok: false,
      reason: `无法解决block,阻断解决器修改了未获批准的模块 ${outside.join(', ')}，请人类评审`,
      outside,
    };
  }
  return { ok: true, outside: [] };
}

module.exports = {
  RECOVERABLE_KINDS,
  HUMAN_KINDS,
  createRecoveryRunId,
  writeJson,
  readJson,
  clearFile,
  evaluateBlockAnalysis,
  captureProjectSnapshot,
  changedPaths,
  evaluateRepairChanges,
  normalizeRelative,
  pathMatches,
};
