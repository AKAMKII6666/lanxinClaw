'use strict';

/**
 * Module: adapters/batchBlock
 * Purpose: Parse ## Batch N blocks with Status / Tasks / Automated checks.
 */

const { parseCheckboxTasks } = require('./checkbox');

function parseBatchBlockTasks(body) {
  const tasks = [];
  const chunks = body.split(/^##\s+Batch\s+/m);
  for (let i = 1; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const firstLineEnd = chunk.indexOf('\n');
    const titleLine = firstLineEnd >= 0 ? chunk.slice(0, firstLineEnd) : chunk;
    const block = firstLineEnd >= 0 ? chunk.slice(firstLineEnd + 1) : '';
    const batchId = titleLine.replace(/[:：].*$/, '').trim().split(/\s+/)[0];
    const statusMatch = block.match(/Status:\s*(\w+)/i);
    const batchStatus = statusMatch ? statusMatch[1].toUpperCase() : '';
    const tasksSection = block.match(/###\s*Tasks\s*\n([\s\S]*?)(?=###|$)/i);
    const sectionBody = tasksSection ? tasksSection[1] : block;
    const parsed = parseCheckboxTasks(sectionBody);
    for (const t of parsed) {
      tasks.push({
        ...t,
        batchId,
        batchStatus,
        source: 'batch-block',
      });
    }
  }
  return tasks;
}

module.exports = { parseBatchBlockTasks };
