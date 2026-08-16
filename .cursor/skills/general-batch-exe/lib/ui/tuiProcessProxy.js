'use strict';

/**
 * Module: ui/tuiProcessProxy
 * Purpose: Synchronous writer facade backed by an independent TUI process.
 *
 * Unix: handshake/control via extra stdio pipes (fd 4 / fd 5) + sync read/write.
 * Windows: those pipe fds often expose -1; use a temp-file transport that still
 * works under Atomics.wait (no event-loop pump required).
 */

const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isProcessAlive } = require('./processLiveness');

const FORWARDED_METHODS = [
  'log',
  'setHeader',
  'setFsm',
  'setAgent',
  'clearAgent',
  'onTeeEvent',
  'render',
];

function nativeFd(stream) {
  const fd = stream?.fd ?? stream?._handle?.fd;
  return Number.isInteger(fd) && fd >= 0 ? fd : null;
}

function sleepMs(ms) {
  const waitCell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitCell, 0, 0, Math.max(1, ms));
}

function preferFileTransport() {
  return process.platform === 'win32' || process.env.GBX_TUI_FILE_IPC === '1';
}

function createIpcDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tui-ipc-'));
  return {
    dir,
    readyFile: path.join(dir, 'ready'),
    controlFile: path.join(dir, 'control'),
    dismissFile: path.join(dir, 'dismiss'),
    destroyedFile: path.join(dir, 'destroyed'),
    cancelFile: path.join(dir, 'cancel'),
  };
}

function cleanupIpcDir(ipc) {
  if (!ipc || !ipc.dir) return;
  try {
    fs.rmSync(ipc.dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function waitUntilFileContent(
  filePath,
  expected,
  { timeoutMs = 5_000, errorPrefix = 'ERROR:', isAlive = null } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(filePath)) {
        const text = fs.readFileSync(filePath, 'utf8').trim();
        if (!text) {
          sleepMs(10);
          continue;
        }
        if (text.startsWith(errorPrefix)) {
          throw new Error(text.slice(errorPrefix.length) || 'TUI renderer error');
        }
        if (!expected || text === expected) return text;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (typeof isAlive === 'function' && !isAlive()) {
      throw new Error(`TUI renderer exited while waiting for ${path.basename(filePath)}`);
    }
    sleepMs(10);
  }
  throw new Error(`TUI file handshake timed out waiting for ${path.basename(filePath)}`);
}

function waitUntilFirstFrameFd(child) {
  const readyPipe = child.stdio[4];
  const readyFd = nativeFd(readyPipe);
  if (readyFd == null) {
    throw new Error('TUI startup handshake pipe is unavailable');
  }
  const buffer = Buffer.alloc(4096);
  const deadline = Date.now() + 5_000;
  let bytes = 0;
  while (bytes === 0) {
    try {
      bytes = fs.readSync(readyFd, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error.code !== 'EAGAIN') throw error;
      if (Date.now() >= deadline) {
        throw new Error('TUI renderer did not produce its first frame within 5 seconds');
      }
      sleepMs(10);
    }
  }
  const response = buffer.toString('utf8', 0, bytes).trim();
  if (response !== 'READY') {
    throw new Error(response.replace(/^ERROR:/, '') || 'TUI renderer exited before first frame');
  }
}

function writeControlMessageFd(fd, message) {
  const payload = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
  const deadline = Date.now() + 2_000;
  let offset = 0;

  while (offset < payload.length) {
    try {
      const written = fs.writeSync(fd, payload, offset, payload.length - offset);
      if (written === 0) {
        if (Date.now() >= deadline) return false;
        sleepMs(2);
        continue;
      }
      offset += written;
    } catch (error) {
      if (error.code !== 'EAGAIN') return false;
      if (Date.now() >= deadline) return false;
      sleepMs(2);
    }
  }
  return true;
}

function waitUntilDismissedFd(child, timeoutMs = 3_600_000) {
  const ackPipe = child.stdio[4];
  const ackFd = nativeFd(ackPipe);
  if (ackFd == null) {
    throw new Error('TUI dismiss handshake pipe is unavailable');
  }
  const buffer = Buffer.alloc(4096);
  const deadline = Date.now() + timeoutMs;
  let bytes = 0;
  while (bytes === 0) {
    try {
      bytes = fs.readSync(ackFd, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error.code !== 'EAGAIN') throw error;
      if (Date.now() >= deadline) {
        throw new Error('TUI dismiss wait timed out');
      }
      sleepMs(50);
    }
  }
  const response = buffer.toString('utf8', 0, bytes).trim();
  if (response !== 'DISMISSED') {
    throw new Error(response.replace(/^ERROR:/, '') || 'TUI renderer exited before dismiss');
  }
}

function writeControlMessageFile(controlFile, message) {
  try {
    fs.appendFileSync(controlFile, `${JSON.stringify(message)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function createTuiProcessProxy(options = {}, dependencies = {}) {
  const hostFile = dependencies.hostFile || path.join(__dirname, 'tuiProcessHost.js');
  const useFile = preferFileTransport();
  const ipc = useFile ? createIpcDir() : null;

  const childOptions = {
    ...options,
    transport: useFile ? 'file' : 'fd',
    ipcDir: ipc ? ipc.dir : null,
    readyFile: ipc ? ipc.readyFile : null,
    controlFile: ipc ? ipc.controlFile : null,
    dismissFile: ipc ? ipc.dismissFile : null,
    destroyedFile: ipc ? ipc.destroyedFile : null,
    cancelFile: ipc ? ipc.cancelFile : null,
  };

  if (ipc) {
    fs.writeFileSync(ipc.controlFile, '', 'utf8');
  }

  const child = fork(hostFile, [], {
    env: {
      ...process.env,
      GBX_TUI_OPTIONS: JSON.stringify(childOptions),
    },
    // fd 4/5 used on Unix; Windows file transport ignores them.
    stdio: useFile
      ? ['inherit', 'inherit', 'inherit', 'ipc']
      : ['inherit', 'inherit', 'inherit', 'ipc', 'pipe', 'pipe'],
  });

  let controlFd = null;
  try {
    if (useFile) {
      waitUntilFileContent(ipc.readyFile, 'READY', {
        timeoutMs: 8_000,
        isAlive: () => isProcessAlive(child.pid),
      });
    } else {
      waitUntilFirstFrameFd(child);
      controlFd = nativeFd(child.stdio[5]);
      if (controlFd == null) {
        throw new Error('TUI control pipe is unavailable');
      }
    }
  } catch (error) {
    child.kill('SIGTERM');
    cleanupIpcDir(ipc);
    throw error;
  }

  let destroyed = false;

  function send(method, args = []) {
    if (destroyed) return;
    const ok = useFile
      ? writeControlMessageFile(ipc.controlFile, { method, args })
      : writeControlMessageFd(controlFd, { method, args });
    if (!ok) {
      destroyed = true;
      child.kill('SIGTERM');
      cleanupIpcDir(ipc);
    }
  }

  const proxy = {
    mode: 'tui',
    rendererPid: child.pid,
    transport: useFile ? 'file' : 'fd',
    isCancelRequested() {
      if (!useFile || !ipc?.cancelFile) return false;
      try {
        return fs.readFileSync(ipc.cancelFile, 'utf8').trim() === 'CANCEL';
      } catch {
        return false;
      }
    },
    destroy() {
      if (destroyed) return;
      const delivered = useFile
        ? writeControlMessageFile(ipc.controlFile, { method: 'destroy', args: [] })
        : writeControlMessageFd(controlFd, { method: 'destroy', args: [] });
      destroyed = true;
      if (!delivered) {
        child.kill('SIGTERM');
      }
      if (useFile && delivered) {
        try {
          waitUntilFileContent(ipc.destroyedFile, 'DESTROYED', {
            timeoutMs: 2_000,
            isAlive: () => isProcessAlive(child.pid),
          });
        } catch {
          child.kill('SIGTERM');
        }
      } else {
        sleepMs(30);
      }
      cleanupIpcDir(ipc);
    },
    awaitDismiss(ctx = {}) {
      if (destroyed) return;
      if (useFile) {
        try {
          fs.unlinkSync(ipc.dismissFile);
        } catch {
          /* ignore */
        }
      }
      const delivered = useFile
        ? writeControlMessageFile(ipc.controlFile, { method: 'awaitDismiss', args: [ctx] })
        : writeControlMessageFd(controlFd, { method: 'awaitDismiss', args: [ctx] });
      if (!delivered) {
        destroyed = true;
        child.kill('SIGTERM');
        cleanupIpcDir(ipc);
        return;
      }
      try {
        if (useFile) {
          waitUntilFileContent(ipc.dismissFile, 'DISMISSED', {
            timeoutMs: 3_600_000,
            isAlive: () => isProcessAlive(child.pid),
          });
        } else {
          waitUntilDismissedFd(child);
        }
      } catch (error) {
        destroyed = true;
        child.kill('SIGTERM');
        cleanupIpcDir(ipc);
        throw error;
      }
    },
  };

  for (const method of FORWARDED_METHODS) {
    proxy[method] = (...args) => send(method, args);
  }

  child.on('error', () => {
    destroyed = true;
  });
  child.on('exit', () => {
    destroyed = true;
    cleanupIpcDir(ipc);
  });

  return proxy;
}

module.exports = {
  createTuiProcessProxy,
  waitUntilFileContent,
  waitUntilFirstFrame: waitUntilFirstFrameFd,
  waitUntilDismissed: waitUntilDismissedFd,
  writeControlMessage: writeControlMessageFd,
  preferFileTransport,
};
