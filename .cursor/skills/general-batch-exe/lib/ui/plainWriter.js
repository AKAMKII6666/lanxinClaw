'use strict';

/**
 * Module: ui/plainWriter
 * Purpose: Default line-based console (v0.6 behavior); no-op lifecycle hooks for TUI parity.
 */

const { waitForStdinKey } = require('./terminalDismiss');

function createPlainWriter() {
  return {
    mode: 'plain',
    screen: null,
    log(text, { level = 'log', multiline = false } = {}) {
      const body = String(text || '');
      if (!body) return;
      if (multiline) {
        if (level === 'info') console.log(body);
        else console.error(body);
        return;
      }
      for (const line of body.split('\n')) {
        if (level === 'info') console.log(line);
        else console.error(line);
      }
    },
    setHeader() {},
    setFsm() {},
    setAgent() {},
    onTeeEvent() {},
    clearAgent() {},
    render() {},
    awaitDismiss(ctx = {}) {
      const message = String(ctx.message || '').trim();
      if (message) {
        console.error(`\n${message}\n`);
      }
      waitForStdinKey();
    },
    destroy() {},
  };
}

module.exports = { createPlainWriter };
