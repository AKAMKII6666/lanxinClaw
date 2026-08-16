'use strict';

/**
 * Module: ui/emit
 * Purpose: Route gbx console output through plain stderr or TUI writer on paths._ui.
 */

function gbxLog(paths, text) {
  const line = String(text);
  if (paths?._ui) {
    paths._ui.log(line, { level: 'info' });
    return;
  }
  console.log(line);
}

function gbxErr(paths, text) {
  const line = String(text);
  if (paths?._ui) {
    paths._ui.log(line, { level: 'log' });
    return;
  }
  console.error(line);
}

function gbxMultiline(paths, text, level = 'log') {
  const body = String(text || '');
  if (!body) return;
  if (paths?._ui) {
    paths._ui.log(body, { level, multiline: true });
    return;
  }
  if (level === 'info') console.log(body);
  else console.error(body);
}

module.exports = { gbxLog, gbxErr, gbxMultiline };
