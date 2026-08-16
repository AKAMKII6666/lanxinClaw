'use strict';

/**
 * Module: adapters/checkbox
 * Purpose: Parse - [ ] / - [x] task lists.
 */

function parseCheckboxTasks(body) {
  const tasks = [];
  const re = /^(\s*)[-*]\s+\[([ xX])\]\s+(\S+)\s+(.*)$/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    const done = m[2].toLowerCase() === 'x';
    tasks.push({
      id: m[3].trim(),
      title: (m[4] || '').trim(),
      status: done ? 'done' : 'todo',
      verify: null,
      source: 'checkbox',
    });
  }
  return tasks;
}

module.exports = { parseCheckboxTasks };
