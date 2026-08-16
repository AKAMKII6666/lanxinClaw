'use strict';

/**
 * Module: adapters/detect
 * Purpose: Choose adapter and parse tasks from execution index body.
 */

const { parseTableTasks } = require('./table');
const { parseCheckboxTasks } = require('./checkbox');
const { parseBatchBlockTasks } = require('./batchBlock');

function detectAndParse(body, preferred) {
  if (preferred === 'table') {
    return { adapter: 'table', tasks: parseTableTasks(body) };
  }
  if (preferred === 'checkbox') {
    return { adapter: 'checkbox', tasks: parseCheckboxTasks(body) };
  }
  if (preferred === 'batch-block' || preferred === 'batchBlock') {
    return { adapter: 'batch-block', tasks: parseBatchBlockTasks(body) };
  }

  const table = parseTableTasks(body);
  if (table.length > 0) {
    return { adapter: 'table', tasks: table };
  }
  const batches = parseBatchBlockTasks(body);
  if (batches.length > 0) {
    return { adapter: 'batch-block', tasks: batches };
  }
  const checks = parseCheckboxTasks(body);
  return { adapter: 'checkbox', tasks: checks };
}

module.exports = { detectAndParse };
