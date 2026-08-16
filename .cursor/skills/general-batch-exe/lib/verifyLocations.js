'use strict';

/**
 * Module: verifyLocations
 * Purpose: Heuristic extraction of file:line diagnostics from verify output.
 * Covers tsc, eslint-ish, Studio quality gate lines (STUDIO-STRUCT / COMMENT),
 * and Engine structure gate lines (ENGINE-STRUCT).
 */

/**
 * @typedef {{ file: string, line: number, column: number | null, code: string | null, message: string }} ErrorLocation
 */

/**
 * Parse tsc / eslint / Studio structure / comment diagnostics from combined stdout+stderr.
 * @param {string} text
 * @param {{ max?: number }} [opts]
 * @returns {ErrorLocation[]}
 */
function extractErrorLocations(text, opts = {}) {
  const max = opts.max != null ? opts.max : 40;
  const raw = String(text || '');
  const out = [];
  const seen = new Set();

  const patterns = [
    // Studio / Engine quality:
    // STUDIO-STRUCT-008  path:1:1  message…
    // WARN STUDIO-STRUCT-002  path:36:60  message…（告警线 → severity warn）
    // ENGINE-STRUCT-002  path:18:1  …超过告警线…（无 WARN 前缀，靠文案判定）
    {
      re: /^(?:(WARN)\s+)?((?:STUDIO-(?:STRUCT|COMMENT)|ENGINE-STRUCT)-\d+)\s+(\S+):(\d+):(\d+)\s+(.+)$/gm,
      map: (m) => {
        const message = m[6].trim();
        const warnPrefix = Boolean(m[1]);
        const warnMsg = /告警线/.test(message);
        return {
          file: m[3],
          line: Number(m[4]),
          column: Number(m[5]),
          code: m[2],
          message,
          severity: warnPrefix || warnMsg ? 'warn' : 'error',
        };
      },
    },
    // TypeScript: path(line,col): error TSxxxx: message  (path may contain parentheses)
    {
      re: /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/gm,
      map: (m) => ({
        file: m[1],
        line: Number(m[2]),
        column: Number(m[3]),
        code: m[4],
        message: m[5].trim(),
        severity: 'error',
      }),
    },
    // ESLint stylish / many CLI: path:line:col: message
    {
      re: /([^\s:]+):(\d+):(\d+):\s*(.+)$/gm,
      map: (m) => {
        const message = m[4].trim();
        const codeMatch = message.match(/\b(TS\d+|eslint\/[\w-]+|STUDIO-(?:STRUCT|COMMENT)-\d+)\b/);
        return {
          file: m[1],
          line: Number(m[2]),
          column: Number(m[3]),
          code: codeMatch ? codeMatch[1] : null,
          message,
          severity: /告警线/.test(message) || /\bWARN\b/i.test(message) ? 'warn' : 'error',
        };
      },
    },
    // Generic: path:line: error … (no column)
    {
      re: /([^\s:]+):(\d+):\s+(error|Error|ERROR)[:\s]+(.+)$/gm,
      map: (m) => ({
        file: m[1],
        line: Number(m[2]),
        column: null,
        code: null,
        message: m[4].trim(),
        severity: 'error',
      }),
    },
  ];

  for (const { re, map } of patterns) {
    re.lastIndex = 0;
    let match = re.exec(raw);
    while (match && out.length < max) {
      const loc = map(match);
      const file = loc.file;
      if (!file || file.startsWith('[gbx]') || file.includes('node_modules')) {
        match = re.exec(raw);
        continue;
      }
      if (!Number.isFinite(loc.line) || loc.line <= 0) {
        match = re.exec(raw);
        continue;
      }

      const key = `${file}|${loc.line}|${loc.column || ''}|${loc.code || ''}|${loc.message.slice(0, 80)}`;
      if (seen.has(key)) {
        match = re.exec(raw);
        continue;
      }
      seen.add(key);
      out.push({
        file,
        line: loc.line,
        column: Number.isFinite(loc.column) ? loc.column : null,
        code: loc.code,
        message: loc.message.slice(0, 400),
        severity: loc.severity === 'warn' ? 'warn' : 'error',
      });
      match = re.exec(raw);
    }
  }

  // Prefer Studio/Engine STRUCT hard errors before WARN / other diagnostics.
  out.sort((a, b) => {
    function rank(loc) {
      if (loc.severity === 'warn') return 4;
      if (!loc.code) return 3;
      if (
        (loc.code.startsWith('STUDIO-STRUCT') || loc.code.startsWith('ENGINE-STRUCT')) &&
        !/告警线/.test(loc.message)
      ) {
        return 0;
      }
      if (loc.code.startsWith('STUDIO-') || loc.code.startsWith('ENGINE-')) return 1;
      if (loc.code.startsWith('TS')) return 2;
      return 3;
    }
    return rank(a) - rank(b);
  });

  return out.slice(0, max);
}

/**
 * Pull Studio structure / quality failure lines for Fixer excerpt (longer than generic tails).
 * @param {string} text
 * @param {number} [maxChars]
 */
function extractStudioQualityTail(text, maxChars = 4500) {
  const lines = String(text || '').split('\n');
  const interesting = lines.filter((line) =>
    /STUDIO-STRUCT-|STUDIO-COMMENT-|check:studio-structure|check:comments|quality:studio FAILED|quality:studio failed|ensure-modal-layout/i.test(
      line,
    ),
  );
  if (interesting.length === 0) return '';
  const joined = interesting.join('\n');
  if (joined.length <= maxChars) return joined;
  return joined.slice(-maxChars);
}

module.exports = { extractErrorLocations, extractStudioQualityTail };
