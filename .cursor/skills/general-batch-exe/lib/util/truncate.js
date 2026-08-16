'use strict';

/**
 * Module: util/truncate
 * Purpose: Keep STATE.json from bloating with full agent logs.
 */

function truncate(text, max = 4000) {
  const s = text == null ? '' : String(text);
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

module.exports = { truncate };
