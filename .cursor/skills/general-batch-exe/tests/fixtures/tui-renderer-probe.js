#!/usr/bin/env node
'use strict';

const fs = require('fs');

const options = JSON.parse(process.env.GBX_TUI_OPTIONS || '{}');
const useFile = options.transport === 'file';
let timer = null;
let controlOffset = 0;
let controlBuffer = '';

function notify(message) {
  if (useFile && options.readyFile) {
    fs.writeFileSync(options.readyFile, `${message}\n`, 'utf8');
    return;
  }
  fs.writeSync(4, `${message}\n`);
}

function notifyDismissed() {
  if (useFile && options.dismissFile) {
    fs.writeFileSync(options.dismissFile, 'DISMISSED\n', 'utf8');
    return;
  }
  fs.writeSync(4, 'DISMISSED\n');
}

if (useFile && options.cancelOnReady && options.cancelFile) {
  fs.writeFileSync(options.cancelFile, 'CANCEL\n', 'utf8');
}
notify('READY');

function dispatch(message) {
  if (message?.method === 'setAgent' && !timer) {
    timer = setInterval(() => {
      fs.appendFileSync(options.probeFile, 'render\n');
    }, 40);
    return;
  }
  if (message?.method === 'onTeeEvent') {
    fs.appendFileSync(options.probeFile, `event:${message.args?.[0]?.kind || 'unknown'}\n`);
    return;
  }
  if (message?.method === 'awaitDismiss') {
    fs.appendFileSync(
      options.probeFile,
      `dismiss:${message.args?.[0]?.message || ''}\n`,
    );
    notifyDismissed();
    return;
  }
  if (message?.method === 'destroy') {
    if (timer) clearInterval(timer);
    if (useFile && options.destroyedFile) {
      fs.writeFileSync(options.destroyedFile, 'DESTROYED\n', 'utf8');
    }
    process.exit(0);
  }
}

if (useFile && options.controlFile) {
  setInterval(() => {
    try {
      if (!fs.existsSync(options.controlFile)) return;
      const stat = fs.statSync(options.controlFile);
      if (stat.size < controlOffset) {
        controlOffset = 0;
        controlBuffer = '';
      }
      if (stat.size === controlOffset) return;
      const fd = fs.openSync(options.controlFile, 'r');
      try {
        const length = stat.size - controlOffset;
        const chunk = Buffer.alloc(length);
        fs.readSync(fd, chunk, 0, length, controlOffset);
        controlOffset = stat.size;
        controlBuffer += chunk.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
      let newline;
      while ((newline = controlBuffer.indexOf('\n')) >= 0) {
        const line = controlBuffer.slice(0, newline);
        controlBuffer = controlBuffer.slice(newline + 1);
        if (line.trim()) dispatch(JSON.parse(line));
      }
    } catch {
      /* ignore */
    }
  }, 20);
} else {
  const control = fs.createReadStream(null, {
    fd: 5,
    autoClose: false,
    encoding: 'utf8',
  });
  control.on('data', (chunk) => {
    controlBuffer += chunk;
    let newline;
    while ((newline = controlBuffer.indexOf('\n')) >= 0) {
      const line = controlBuffer.slice(0, newline);
      controlBuffer = controlBuffer.slice(newline + 1);
      if (line.trim()) dispatch(JSON.parse(line));
    }
  });
}

process.on('message', dispatch);
process.on('disconnect', () => process.exit(0));
