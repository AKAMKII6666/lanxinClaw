'use strict';

/**
 * Module: consoleTheme
 * Purpose: ANSI styling for gbx live console — role banners, activity lines, block recovery.
 */

const path = require('path');

const ROLE_STYLES = {
  executor: { label: 'EXECUTOR', hue: 'blue' },
  'batch-reviewer': { label: 'REVIEWER', hue: 'cyan' },
  reviewer: { label: 'REVIEWER', hue: 'cyan' },
  fixer: { label: 'FIXER', hue: 'yellow' },
  'final-reviewer': { label: 'FINAL REVIEWER', hue: 'cyan' },
  'final-fixer': { label: 'FINAL FIXER', hue: 'yellow' },
  'block-analyzer': { label: 'BLOCK ANALYZER', hue: 'magenta' },
  'block-resolver': { label: 'BLOCK RESOLVER', hue: 'red' },
  verify: { label: 'VERIFY', hue: 'green' },
  default: { label: 'AGENT', hue: 'white' },
};

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  white: '\x1b[37m',
};

function roleStyle(role) {
  return ROLE_STYLES[role] || ROLE_STYLES.default;
}

function isColorEnabled(options = {}) {
  if (options.color === false || options.enabled === false) {
    return false;
  }
  if (process.env.NO_COLOR || process.env.GBX_NO_COLOR === '1') {
    return false;
  }
  if (options.forceColor === true) {
    return true;
  }
  return Boolean(process.stderr.isTTY);
}

/**
 * @param {{ enabled?: boolean, color?: boolean, forceColor?: boolean }} [options]
 */
function createTheme(options = {}) {
  const color = isColorEnabled(options);
  const wrap = (hue, text, { bold = false, dim = false } = {}) => {
    if (!color) return text;
    const open = `${bold ? ANSI.bold : ''}${dim ? ANSI.dim : ''}${ANSI[hue] || ''}`;
    return `${open}${text}${ANSI.reset}`;
  };
  return { color, wrap, options };
}

function truncateText(text, max = 72) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatSummaryValue(value) {
  if (value == null || value === '') return '-';
  if (typeof value !== 'object') return String(value);
  const diagnostic = [
    value.code,
    value.path || value.file,
    value.line != null ? `line ${value.line}` : null,
    value.message,
  ].filter(Boolean);
  if (diagnostic.length) return diagnostic.join(' · ');
  try {
    return JSON.stringify(value);
  } catch {
    return 'unprintable diagnostic';
  }
}

function relPath(filePath, workdir) {
  if (!filePath) return '(unknown)';
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(workdir || process.cwd(), filePath);
  const rel = path.relative(workdir || process.cwd(), abs);
  if (!rel || rel.startsWith('..')) return truncateText(filePath, 56);
  return truncateText(rel.split(path.sep).join('/'), 56);
}

function formatPathsList(paths, workdir, max = 3) {
  const list = (paths || []).map((p) => relPath(p, workdir));
  if (list.length <= max) return list.join(', ') || '(none)';
  return `${list.slice(0, max).join(', ')} (+${list.length - max} more)`;
}

function boxWidth() {
  const cols = process.stderr.columns || 80;
  return Math.max(48, Math.min(cols - 2, 78));
}

function printLines(theme, lines, { stream = process.stderr } = {}) {
  for (const line of lines) {
    stream.write(`${line}\n`);
  }
}

/**
 * Role-colored banner before agent spawn.
 */
function printRoleBanner(theme, role, ctx = {}) {
  if (theme.options.enabled === false) return;
  const style = roleStyle(role);
  const w = boxWidth();
  const title = style.label;
  const bar = '─'.repeat(Math.max(8, w - title.length - 4));
  const hue = style.hue;
  const head = theme.wrap(hue, `[gbx] ╭─ ${title} ${bar}`, { bold: true });
  const body = [];
  const batch = (ctx.batchIds || []).join(',') || '-';
  body.push(`[gbx] │ batch: ${batch}`);
  const tasks = (ctx.taskIds || ctx.batchIds || []).join(',') || '-';
  body.push(`[gbx] │ tasks: ${tasks}`);
  if (ctx.fixTrigger) {
    body.push(`[gbx] │ trigger: ${ctx.fixTrigger}`);
  }
  if (ctx.recoveryAttempt != null && ctx.recoveryMax != null) {
    body.push(`[gbx] │ recovery: ${ctx.recoveryAttempt + 1}/${ctx.recoveryMax}`);
  }
  if (ctx.recoveryKind) {
    body.push(`[gbx] │ kind: ${ctx.recoveryKind}`);
  }
  if (ctx.approvedPaths && ctx.approvedPaths.length) {
    body.push(
      `[gbx] │ approved: ${formatPathsList(ctx.approvedPaths, ctx.workdir)}`,
    );
  }
  if (ctx.promptHint) {
    body.push(`[gbx] │ prompt: ${truncateText(ctx.promptHint, w - 14)}`);
  }
  const foot = theme.wrap('white', `[gbx] ╰${'─'.repeat(w - 6)}`, { dim: true });
  printLines(theme, [head, ...body.map((l) => theme.wrap('white', l, { dim: true })), foot]);
}

function formatAgentStart(theme, role, label, meta = {}) {
  const hue = roleStyle(role).hue;
  const cmd = meta.command || 'agent';
  const cwd = meta.workdir || process.cwd();
  const head = theme.wrap(hue, `[gbx] ▶ ${label}`, { bold: true });
  const tail = theme.wrap('white', ` start cmd=${cmd} cwd=${cwd}`, { dim: true });
  return `${head}${tail}\n`;
}

function formatAgentActivity(theme, role, text) {
  const hue = roleStyle(role).hue;
  const body = truncateText(text, 96);
  return `${theme.wrap(hue, '[gbx] · ', { bold: true })}${body}\n`;
}

function formatAgentHeartbeat(theme, role, label, elapsedSec, lastActivity) {
  const hue = roleStyle(role).hue;
  const tag = theme.wrap(hue, `[gbx] … ${label}`, { dim: true });
  const time = theme.wrap('white', ` (${elapsedSec}s)`, { dim: true });
  if (lastActivity) {
    return `${tag}${time} | 最近: ${truncateText(lastActivity, 64)}\n`;
  }
  return `${tag}${time}\n`;
}

function formatAgentDone(theme, role, label, exitCode, elapsedSec, signal) {
  const ok = exitCode === 0;
  const hue = ok ? 'green' : 'red';
  const sig = signal ? ` signal=${signal}` : '';
  return `${theme.wrap(hue, `[gbx] ■ ${label} done exit=${exitCode}${sig} elapsed=${elapsedSec}s`, { bold: true })}\n`;
}

function formatAgentError(theme, role, label, message) {
  return `${theme.wrap('red', `[gbx] ✖ ${label} spawn error: ${message}`, { bold: true })}\n`;
}

function formatFsmStatus(theme, iteration, status) {
  return `${theme.wrap('white', `[gbx] Iteration=${iteration} Status=${status}`, { dim: true })}\n`;
}

/** Block recovery: entering analyze phase. */
function blockRecoveryAnalyzeStart(theme, ctx = {}) {
  const fingerprint = formatSummaryValue(ctx.fingerprint || ctx.reason);
  const lines = [
    theme.wrap('magenta', '[gbx] ⛔ VERIFY 阻断 → 启动自动分析', { bold: true }),
    theme.wrap('white', `[gbx]    fingerprint: ${truncateText(fingerprint, 64)}`, {
      dim: true,
    }),
    theme.wrap('white', `[gbx]    recovery ${(ctx.attempt || 0) + 1}/${ctx.maxAttempts || '?'} · spawn block-analyzer（只读）`, {
      dim: true,
    }),
  ];
  return lines;
}

/** Block recovery: analysis passed policy gate. */
function blockRecoveryAnalysisOk(theme, ctx = {}) {
  return [
    theme.wrap('green', `[gbx] ✓ 分析完成 · kind=${ctx.kind || '-'} · confidence=${ctx.confidence || '-'}`, {
      bold: true,
    }),
    theme.wrap('white', `[gbx]    批准路径: ${formatPathsList(ctx.approvedPaths, ctx.workdir)}`, { dim: true }),
    theme.wrap('magenta', '[gbx] → 进入 BLOCK_REPAIR · spawn block-resolver', { bold: true }),
  ];
}

/** Block recovery: analysis denied. */
function blockRecoveryAnalysisDenied(theme, reason) {
  return [
    theme.wrap('red', '[gbx] ✖ 自动恢复中止 · 分析未通过策略门', { bold: true }),
    theme.wrap('white', `[gbx]    ${truncateText(reason || '未知原因', 72)}`, { dim: true }),
    theme.wrap('white', '[gbx]    见 reports/latest-block-analysis.json', { dim: true }),
  ];
}

/** Block recovery: repair completed. */
function blockRecoveryRepairOk(theme, ctx = {}) {
  const touched = ctx.changedCount != null ? ctx.changedCount : (ctx.changedPaths || []).length;
  return [
    theme.wrap('green', `[gbx] ✓ 修复报告: result=${ctx.result || 'repaired'} · touched=${touched} files`, {
      bold: true,
    }),
    theme.wrap('magenta', `[gbx] → BLOCK_VERIFY · 重跑 ${truncateText(ctx.verifyHint || 'verify', 48)}`, {
      bold: true,
    }),
  ];
}

/** Block recovery: handoff back to normal FSM. */
function blockRecoveryVerifyHandoff(theme, resumeStatus) {
  return [
    theme.wrap('green', `[gbx] ✓ 阻断恢复验证通过 → 恢复 ${resumeStatus}`, { bold: true }),
  ];
}

function stripAnsiForUi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function printBlockRecovery(theme, kind, ctx = {}, paths = null) {
  if (theme.options.enabled === false) return;
  let lines = [];
  if (kind === 'analyze-start') lines = blockRecoveryAnalyzeStart(theme, ctx);
  else if (kind === 'analysis-ok') lines = blockRecoveryAnalysisOk(theme, ctx);
  else if (kind === 'analysis-denied') lines = blockRecoveryAnalysisDenied(theme, ctx.reason);
  else if (kind === 'repair-ok') lines = blockRecoveryRepairOk(theme, ctx);
  else if (kind === 'verify-handoff') lines = blockRecoveryVerifyHandoff(theme, ctx.resumeStatus);
  if (!lines.length) return;
  if (paths?._ui?.mode === 'tui') {
    for (const line of lines) {
      paths._ui.log(stripAnsiForUi(line));
    }
    return;
  }
  printLines(theme, lines);
}

module.exports = {
  ROLE_STYLES,
  createTheme,
  roleStyle,
  relPath,
  truncateText,
  formatSummaryValue,
  printRoleBanner,
  printBlockRecovery,
  formatAgentStart,
  formatAgentActivity,
  formatAgentHeartbeat,
  formatAgentDone,
  formatAgentError,
  formatFsmStatus,
  blockRecoveryAnalyzeStart,
  blockRecoveryAnalysisOk,
  blockRecoveryRepairOk,
};
