#!/usr/bin/env node
'use strict';

/**
 * Module: ui/tuiProcessHost
 * Purpose: Run neo-blessed outside the synchronous orchestrator process.
 *
 * transport=fd (Unix default): READY/DISMISS on fd 4, control on fd 5.
 * transport=file (Windows): READY/DISMISS/control via temp files in options.
 */

const fs = require('fs');
const { createTuiApp } = require('./tuiApp');

function loadOptions() {
  return JSON.parse(process.env.GBX_TUI_OPTIONS || '{}');
}

function createNotifiers(options) {
  const useFile = options.transport === 'file';

  function notifyStartup(message) {
    try {
      if (useFile && options.readyFile) {
        fs.writeFileSync(options.readyFile, `${message}\n`, 'utf8');
        return;
      }
      fs.writeSync(4, `${message}\n`);
    } catch {
      /* Parent may have already exited. */
    }
  }

  function notifyDismissed() {
    try {
      if (useFile && options.dismissFile) {
        fs.writeFileSync(options.dismissFile, 'DISMISSED\n', 'utf8');
        return;
      }
      fs.writeSync(4, 'DISMISSED\n');
    } catch {
      /* Parent may have already exited. */
    }
  }

  function notifyDestroyed() {
    if (!useFile || !options.destroyedFile) return;
    try {
      fs.writeFileSync(options.destroyedFile, 'DESTROYED\n', 'utf8');
    } catch {
      /* Parent may have already exited. */
    }
  }

  function notifyCancel() {
    if (!useFile || !options.cancelFile) return;
    try {
      fs.writeFileSync(options.cancelFile, 'CANCEL\n', 'utf8');
    } catch {
      /* Parent may have already exited. */
    }
  }

  return {
    notifyStartup,
    notifyDismissed,
    notifyDestroyed,
    notifyCancel,
    useFile,
  };
}

function attachFileControl(options, dispatch) {
  let offset = 0;
  let buffer = '';
  const controlFile = options.controlFile;
  if (!controlFile) return null;

  const timer = setInterval(() => {
    try {
      if (!fs.existsSync(controlFile)) return;
      const stat = fs.statSync(controlFile);
      if (stat.size < offset) {
        // File truncated/recreated
        offset = 0;
        buffer = '';
      }
      if (stat.size === offset) return;
      const fd = fs.openSync(controlFile, 'r');
      try {
        const length = stat.size - offset;
        const chunk = Buffer.alloc(length);
        fs.readSync(fd, chunk, 0, length, offset);
        offset = stat.size;
        buffer += chunk.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          dispatch(JSON.parse(line));
        } catch {
          /* Ignore malformed control messages. */
        }
      }
    } catch {
      /* Transient read errors while parent rewrites. */
    }
  }, 40);

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

function main() {
  let options;
  try {
    options = loadOptions();
  } catch (error) {
    try {
      fs.writeSync(4, `ERROR:${error.message}\n`);
    } catch {
      /* ignore */
    }
    process.exit(1);
    return;
  }

  const {
    notifyStartup,
    notifyDismissed,
    notifyDestroyed,
    notifyCancel,
    useFile,
  } = createNotifiers(options);

  let ui;
  try {
    ui = createTuiApp({ ...options, onCancel: notifyCancel });
    notifyStartup('READY');
  } catch (error) {
    notifyStartup(`ERROR:${error.message}`);
    process.exit(1);
    return;
  }

  function dispatch(message) {
    if (!message || typeof message.method !== 'string') return;
    if (message.method === 'destroy') {
      ui.destroy();
      notifyDestroyed();
      process.exit(0);
      return;
    }
    if (message.method === 'awaitDismiss') {
      const ctx = Array.isArray(message.args) ? message.args[0] || {} : {};
      ui.awaitDismiss(ctx, notifyDismissed);
      return;
    }
    const method = ui[message.method];
    if (typeof method === 'function') {
      method(...(Array.isArray(message.args) ? message.args : []));
    }
  }

  let controlTimer = null;
  if (useFile) {
    controlTimer = attachFileControl(options, dispatch);
  } else {
    let controlBuffer = '';
    const controlStream = fs.createReadStream(null, {
      fd: 5,
      autoClose: false,
      encoding: 'utf8',
    });
    controlStream.on('data', (chunk) => {
      controlBuffer += chunk;
      let newline;
      while ((newline = controlBuffer.indexOf('\n')) >= 0) {
        const line = controlBuffer.slice(0, newline);
        controlBuffer = controlBuffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          dispatch(JSON.parse(line));
        } catch {
          /* Ignore malformed control messages without taking down the workflow. */
        }
      }
    });
    controlStream.on('error', () => {
      ui.destroy();
      process.exit(1);
    });
  }

  // Kept as a compatibility path for older proxy callers.
  process.on('message', dispatch);

  process.on('disconnect', () => {
    if (controlTimer) clearInterval(controlTimer);
    ui.destroy();
    process.exit(0);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (controlTimer) clearInterval(controlTimer);
      ui.destroy();
      process.exit(0);
    });
  }
}

main();
