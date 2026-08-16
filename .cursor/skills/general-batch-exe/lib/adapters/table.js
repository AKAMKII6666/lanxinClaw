'use strict';

/**
 * Module: adapters/table
 * Purpose: Parse markdown status tables (状态 | ID | 任务 | verify).
 */

const DONE = new Set(['✅', '[x]', '[X]', '- [x]', '- [X]']);
const TODO = new Set(['⬜', '[ ]', '- [ ]']);

function normalizeStatus(raw) {
  const s = String(raw || '').trim();
  if (!s) {
    return 'unknown';
  }
  if (DONE.has(s) || /^✅/.test(s) || /^\[[xX]\]/.test(s) || /^-\s*\[[xX]\]/.test(s)) {
    return 'done';
  }
  if (TODO.has(s) || /^⬜/.test(s) || /^\[[ ]\]/.test(s) || /^-\s*\[[ ]\]/.test(s)) {
    return 'todo';
  }
  if (s === '✅' || s.toLowerCase() === 'done' || s === 'x') {
    return 'done';
  }
  if (s === '⬜' || s.toLowerCase() === 'todo') {
    return 'todo';
  }
  return 'unknown';
}

function parseTableTasks(body) {
  const lines = body.split(/\r?\n/);
  const tasks = [];
  let headerIdx = -1;
  let cols = { status: 0, id: 1, task: 2, verify: 3 };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) {
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) {
      continue;
    }
    const headerJoined = cells.join('|').toLowerCase();
    if (
      headerJoined.includes('状态') ||
      headerJoined.includes('status') ||
      (headerJoined.includes('id') && headerJoined.includes('任务'))
    ) {
      headerIdx = i;
      cols = { status: 0, id: 1, task: 2, verify: 3 };
      cells.forEach((c, idx) => {
        const low = c.toLowerCase();
        if (low.includes('状态') || low === 'status') cols.status = idx;
        if (low === 'id') cols.id = idx;
        if (low.includes('任务') || low === 'task') cols.task = idx;
        if (low.includes('verify')) cols.verify = idx;
      });
      continue;
    }
    if (headerIdx < 0) {
      continue;
    }
    // separator row
    if (cells.every((c) => /^:?-+:?$/.test(c))) {
      continue;
    }
    const statusRaw = cells[cols.status] || '';
    const id = cells[cols.id] || '';
    const title = cells[cols.task] || '';
    const verifyRaw = cells[cols.verify] != null ? cells[cols.verify] : '';
    if (!id) {
      continue;
    }
    const status = normalizeStatus(statusRaw);
    if (status === 'unknown') {
      continue;
    }
    const verify =
      !verifyRaw || verifyRaw === '—' || verifyRaw === '-' || verifyRaw.toLowerCase() === 'n/a'
        ? null
        : verifyRaw;
    tasks.push({
      id: id.trim(),
      title: title.trim(),
      status,
      verify,
      source: 'table',
    });
  }
  return tasks;
}

module.exports = { parseTableTasks, normalizeStatus };
