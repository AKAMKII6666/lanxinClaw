'use strict';

/**
 * Module: verifyReport
 * Purpose: Canonical verify failure snapshots for Fixer + BLOCKED reporting.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { extractErrorLocations, extractStudioQualityTail } = require('./verifyLocations');

const LATEST_VERIFY_NAME = 'latest-verify.json';

function tail(text, n = 2000) {
  const s = String(text || '');
  if (s.length <= n) return s;
  return s.slice(-n);
}

function clip(text, maxBytes) {
  const s = String(text || '');
  if (s.length <= maxBytes) return s;
  return s.slice(0, maxBytes);
}

/**
 * @param {object} args
 * @param {string} args.label
 * @param {boolean} args.ok
 * @param {object[]} args.results  raw runOne results
 * @param {string} [args.phase]
 * @param {string[]} [args.activeTaskIds]
 * @param {string} [args.reason]
 * @param {number} [args.maxBytes]
 */
function buildVerifyReport({
  label,
  ok,
  results,
  phase = 'batch',
  activeTaskIds = [],
  reason = '',
  maxBytes = 65536,
}) {
  const enriched = (results || []).map((r) => {
    const stdout = clip(r.stdout || '', maxBytes);
    const stderr = clip(r.stderr || '', maxBytes);
    const combined = `${stdout}\n${stderr}`;
    const hasStudioGate = /STUDIO-STRUCT-|STUDIO-COMMENT-|quality:studio|check:studio-structure/i.test(
      combined,
    );
    const tailLen = hasStudioGate ? 4500 : 2000;
    return {
      command: r.command,
      exitCode: r.exitCode,
      signal: r.signal || null,
      error: r.error || null,
      stdout,
      stderr,
      stdoutTail: tail(stdout, tailLen),
      stderrTail: tail(stderr, tailLen),
      errorLocations: extractErrorLocations(combined),
    };
  });

  const failed = enriched.find((r) => r.exitCode !== 0) || null;
  const allLocations = enriched.flatMap((r) => r.errorLocations || []);

  return {
    schemaVersion: 1,
    label,
    at: new Date().toISOString(),
    ok: Boolean(ok),
    phase,
    activeTaskIds: activeTaskIds || [],
    reason: reason || (ok ? 'all commands passed' : 'command failed'),
    failedCommand: failed ? failed.command : null,
    exitCode: failed ? failed.exitCode : 0,
    results: enriched,
    errorLocations: allLocations.slice(0, 40),
  };
}

function verifyFingerprint(report) {
  if (!report || report.ok) {
    return null;
  }
  const payload = {
    failedCommand: report.failedCommand || '',
    exitCode: report.exitCode,
    locations: (report.errorLocations || []).map((l) => ({
      file: l.file,
      line: l.line,
      column: l.column,
      code: l.code,
    })),
    stderrTail: tail(
      (report.results || [])
        .map((r) => r.stderrTail || '')
        .join('\n'),
      800,
    ).replace(/\s+/g, ' '),
  };
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function writeVerifyReports(paths, report) {
  if (!paths || !paths.reports) {
    return { historyFile: null, latestFile: null };
  }
  fs.mkdirSync(paths.reports, { recursive: true });
  const historyName = `${report.label}-${Date.now()}.json`;
  const historyFile = path.join(paths.reports, historyName);
  const latestFile = path.join(paths.reports, LATEST_VERIFY_NAME);
  const withHistory = { ...report, historyFile: historyName };
  const body = `${JSON.stringify(withHistory, null, 2)}\n`;
  fs.writeFileSync(historyFile, body, 'utf8');
  fs.writeFileSync(latestFile, body, 'utf8');
  return { historyFile, latestFile };
}

function loadLatestVerify(paths) {
  if (!paths || !paths.latestVerify) return null;
  if (!fs.existsSync(paths.latestVerify)) return null;
  try {
    return JSON.parse(fs.readFileSync(paths.latestVerify, 'utf8'));
  } catch {
    return null;
  }
}

function formatBlockedVerifyReport({ blockedReason, state, report, latestVerifyPath, latestReviewPath }) {
  const lines = [];
  const reason = blockedReason || (state && state.blockedReason) || '(none)';
  const checkboxGap =
    /checkbox_missing/i.test(String(reason)) ||
    (state && state.fixTrigger === 'checkbox_missing') ||
    (report && report.ok === true && /not checked|checkbox/i.test(String(reason)));

  lines.push('[gbx] ========== BLOCKED ==========');
  lines.push(`[gbx] reason: ${reason}`);
  const ids = (state && state.activeTaskIds) || [];
  lines.push(`[gbx] activeTaskIds: ${ids.join(',') || '(none)'}`);

  if (checkboxGap) {
    lines.push('[gbx] kind: checkbox_missing (verify scripts already OK)');
    lines.push(
      `[gbx] action: mark activeTaskIds ✅ in the execution index, then: gbx --clear-blocked --after-manual`,
    );
    if (ids.length) {
      lines.push(`[gbx] unchecked (expected): ${ids.join(',')}`);
    }
    lines.push(
      '[gbx] note: WARN STUDIO-STRUCT-002/003 (告警线) do not fail the gate — do not treat them as the block cause.',
    );
  } else if (report) {
    lines.push(
      `[gbx] failedCommand: ${report.failedCommand || '(unknown)'} (exit ${report.exitCode ?? '?'})`,
    );
    const locs = (report.errorLocations || []).filter((l) => l.severity !== 'warn');
    const warns = (report.errorLocations || []).filter((l) => l.severity === 'warn');
    if (locs.length) {
      lines.push('[gbx] errorLocations (hard only):');
      for (const loc of locs.slice(0, 15)) {
        const col = loc.column != null ? `:${loc.column}` : '';
        const code = loc.code ? `  ${loc.code}` : '';
        lines.push(`[gbx]   - ${loc.file}:${loc.line}${col}${code}  ${loc.message || ''}`);
      }
    } else {
      lines.push('[gbx] errorLocations: (none hard; see verify report tails)');
      const failed = (report.results || []).find((r) => r.exitCode !== 0);
      if (failed) {
        const snippet = tail(`${failed.stdoutTail || ''}\n${failed.stderrTail || ''}`, 1200);
        for (const line of snippet.split('\n').slice(-20)) {
          if (line.trim()) lines.push(`[gbx]   | ${line}`);
        }
      }
    }
    if (warns.length) {
      lines.push(`[gbx] warnLocations omitted from primary list (count=${warns.length})`);
    }
  } else {
    lines.push('[gbx] verify report: (missing)');
  }

  if (latestVerifyPath) lines.push(`[gbx] verify report: ${latestVerifyPath}`);
  if (latestReviewPath) lines.push(`[gbx] review report: ${latestReviewPath}`);
  if (checkboxGap) {
    lines.push(
      '[gbx] hint: after ✅, re-run with --clear-blocked --after-manual (or --reset-state for a full restart)',
    );
  } else {
    lines.push(
      '[gbx] hint: fix the hard locations above, then re-run gbx (often with --reset-state if status stuck BLOCKED)',
    );
  }
  lines.push('[gbx] =============================');
  return lines.join('\n');
}

function buildVerifyExcerptForPrompt(report, maxChars = 12000) {
  if (!report) {
    return '(no latest-verify.json — treat as orchestrator contract error)';
  }
  const lines = [];
  lines.push(`ok=${report.ok} label=${report.label} failedCommand=${report.failedCommand}`);
  lines.push(`exitCode=${report.exitCode} reason=${report.reason}`);
  const locs = report.errorLocations || [];
  const hard = locs.filter((l) => l.severity !== 'warn');
  const warns = locs.filter((l) => l.severity === 'warn');
  if (hard.length) {
    lines.push('errorLocations (hard only; prefer STUDIO-STRUCT hard errors over WARN):');
    for (const loc of hard.slice(0, 25)) {
      const col = loc.column != null ? `:${loc.column}` : '';
      lines.push(`- ${loc.file}:${loc.line}${col} ${loc.code || ''} ${loc.message || ''}`);
    }
  } else {
    lines.push('errorLocations: (none hard — read studioQualityTail / stdout tails)');
  }
  if (warns.length) {
    lines.push(
      `warnLocations: ${warns.length} WARN/告警线 omitted — do NOT burn the fix round only on these.`,
    );
  }
  const failed = (report.results || []).find((r) => r.exitCode !== 0);
  if (failed) {
    const combined = `${failed.stdout || ''}\n${failed.stderr || ''}\n${failed.stdoutTail || ''}\n${failed.stderrTail || ''}`;
    const studioTail = extractStudioQualityTail(combined, 5000);
    if (studioTail) {
      lines.push('--- studioQualityTail (STRUCT/COMMENT/quality gate) ---');
      lines.push(studioTail);
    }
    lines.push('--- stdoutTail ---');
    lines.push(failed.stdoutTail || '');
    lines.push('--- stderrTail ---');
    lines.push(failed.stderrTail || '');
  }
  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n…(truncated)…';
}

function summarizeVerify(report) {
  if (!report) return 'no verify report';
  if (report.ok) return 'verify ok';
  const n = (report.errorLocations || []).length;
  return `${report.failedCommand || 'verify'} exit=${report.exitCode}; ${n} errorLocations`;
}

module.exports = {
  LATEST_VERIFY_NAME,
  buildVerifyReport,
  verifyFingerprint,
  writeVerifyReports,
  loadLatestVerify,
  formatBlockedVerifyReport,
  buildVerifyExcerptForPrompt,
  summarizeVerify,
  extractErrorLocations,
  extractStudioQualityTail,
};
