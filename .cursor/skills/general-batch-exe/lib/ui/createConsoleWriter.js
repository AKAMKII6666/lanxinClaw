'use strict';

/**
 * Module: ui/createConsoleWriter
 * Purpose: Factory for plain vs neo-blessed TUI console writers.
 */

const { createPlainWriter } = require('./plainWriter');
const { createTuiProcessProxy } = require('./tuiProcessProxy');
const { loadSplashArt } = require('./splashArt');
const path = require('path');

function isTtyCapable() {
  if (!process.stdout.isTTY || !process.stderr.isTTY) {
    return false;
  }
  if (process.env.CI === 'true' || process.env.CI === '1') {
    return false;
  }
  return true;
}

/**
 * Windows defaults to plain for `auto` (neo-blessed is flaky on Win consoles).
 * Explicit `--tui` / `GBX_TUI=1` / `console_ui.mode: tui` still opens TUI when TTY-capable.
 * @param {'auto'|'tui'|'plain'} mode
 * @param {boolean} quiet
 */
function resolveConsoleUiMode(mode, quiet) {
  if (quiet) return 'plain';
  const m = mode || 'auto';
  if (m === 'plain') return 'plain';

  const envForceOff = process.env.GBX_TUI === '0' || process.env.GBX_TUI === 'false';
  const envForceOn = process.env.GBX_TUI === '1' || process.env.GBX_TUI === 'true';
  if (envForceOff) return 'plain';

  if (m === 'tui' || envForceOn) {
    return isTtyCapable() ? 'tui' : 'plain';
  }

  // auto: Windows stays plain unless forced above
  if (process.platform === 'win32') {
    return 'plain';
  }
  return isTtyCapable() ? 'tui' : 'plain';
}

function createConsoleWriter(options = {}) {
  const requested = options.mode || 'auto';
  const mode = resolveConsoleUiMode(requested, options.quiet);
  if (requested === 'tui' && mode !== 'tui') {
    const reason = !process.stdout.isTTY || !process.stderr.isTTY
      ? 'stdout/stderr is not a TTY (run in an interactive terminal, not a redirected pipe)'
      : process.env.GBX_TUI === '0' || process.env.GBX_TUI === 'false'
        ? 'GBX_TUI=0 forces plain'
        : options.quiet
          ? 'quiet mode forces plain'
          : 'TTY/CI gate rejected TUI';
    process.stderr.write(`[gbx] --tui requested but using plain: ${reason}\n`);
  }
  if (mode === 'tui') {
    try {
      const splashText = loadSplashArt(
        options.splashFile ||
          path.join(__dirname, '..', '..', 'image', 'ascii-art.txt'),
      );
      return createTuiProcessProxy({
        title: options.title || 'general-batch-exe',
        exFile: options.exFile,
        workflow: options.workflow,
        mouse: options.mouse === true,
        showShortcuts: options.showShortcuts !== false,
        splashText,
        splashMs: options.splashMs == null ? 1_600 : options.splashMs,
      });
    } catch (error) {
      const plain = createPlainWriter();
      plain.log(
        `[gbx] TUI init failed (${error.message}); falling back to plain console.`,
        { level: 'warn' },
      );
      return plain;
    }
  }
  return createPlainWriter();
}

module.exports = { createConsoleWriter, resolveConsoleUiMode, isTtyCapable };
