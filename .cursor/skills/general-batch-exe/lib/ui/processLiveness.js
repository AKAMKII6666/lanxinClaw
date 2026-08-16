'use strict';

/**
 * Synchronous process liveness check for polling loops that intentionally
 * block the Node event loop (Windows file IPC).
 */
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but cannot be signalled.
    return error?.code === 'EPERM';
  }
}

module.exports = { isProcessAlive };
