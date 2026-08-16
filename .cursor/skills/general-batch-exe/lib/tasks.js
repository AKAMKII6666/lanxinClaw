'use strict';

/**
 * Module: tasks
 * Purpose: Select active batch tasks and re-check completion after executor.
 */

function todoTasks(tasks) {
  return tasks.filter((t) => t.status === 'todo');
}

function doneTasks(tasks) {
  return tasks.filter((t) => t.status === 'done');
}

/**
 * Select next batch of todo tasks.
 * group=milestone: only same prefix before first "-" (e.g. M1 from M1-1).
 */
function selectBatch(tasks, { batchSize = 3, group = 'order', fromId = null } = {}) {
  let todos = todoTasks(tasks);
  if (fromId) {
    const idx = todos.findIndex((t) => t.id === fromId || t.id.startsWith(fromId));
    if (idx >= 0) {
      todos = todos.slice(idx);
    }
  }
  if (todos.length === 0) {
    return [];
  }
  if (group === 'milestone') {
    const prefix = todos[0].id.split('-')[0];
    const same = todos.filter((t) => t.id.split('-')[0] === prefix);
    return same.slice(0, batchSize);
  }
  return todos.slice(0, batchSize);
}

/**
 * Merge task-level verify with verify_default (task cmds first, then defaults; dedupe).
 */
function collectVerifyCommands(batchTasks, verifyDefault) {
  const cmds = [];
  const seen = new Set();
  function push(c) {
    if (!c || seen.has(c)) {
      return;
    }
    seen.add(c);
    cmds.push(c);
  }
  for (const t of batchTasks || []) {
    push(t.verify);
  }
  for (const c of verifyDefault || []) {
    push(c);
  }
  return cmds;
}

/**
 * Full verification re-runs every declared command after final-fixer changes.
 */
function collectFullVerifyCommands(tasks, verifyDefault) {
  return collectVerifyCommands(tasks, verifyDefault);
}

/**
 * After executor: ensure every selected batch id is now done in re-parsed tasks.
 */
function assertBatchChecked(tasks, batchIds) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const missing = [];
  for (const id of batchIds) {
    const t = byId.get(id);
    if (!t || t.status !== 'done') {
      missing.push(id);
    }
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  todoTasks,
  doneTasks,
  selectBatch,
  collectVerifyCommands,
  collectFullVerifyCommands,
  assertBatchChecked,
};
