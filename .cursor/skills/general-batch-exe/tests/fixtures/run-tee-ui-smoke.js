'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { runTeeWithUi } = require('../../lib/agent/runner');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tee-ui-'));
const logFile = path.join(dir, 'log.txt');
const eventsFile = path.join(dir, 'events.ndjson');
const payloadFile = path.join(dir, 'payload.json');
const scriptFile = path.join(dir, 'hello.js');

fs.writeFileSync(eventsFile, '');
fs.writeFileSync(
  scriptFile,
  "process.stdout.write('hello-line\\n'); setTimeout(() => process.exit(0), 40);\n",
);
fs.writeFileSync(
  payloadFile,
  `${JSON.stringify(
    {
      command: process.execPath,
      args: [scriptFile],
      workdir: dir,
      logFile,
      heartbeatMs: 0,
      label: 'verify:probe',
      role: 'verify',
      uiPipe: true,
      uiEventsFile: eventsFile,
    },
    null,
    2,
  )}\n`,
);

const lines = [];
const ui = {
  mode: 'tui',
  onTeeEvent(ev) {
    lines.push(`${ev.kind}:${String(ev.text || '').slice(0, 40)}`);
  },
  setAgent() {},
  clearAgent() {},
  render() {},
};

const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'lib', 'agent', 'teeChild.js'), payloadFile], {
  stdio: ['ignore', 'pipe', 'ignore'],
});
const code = runTeeWithUi(child, ui, 10_000, { eventsFile });
if (code !== 0) {
  console.error('FAIL exit', code, lines);
  process.exit(1);
}
if (!lines.some((l) => l.includes('hello-line'))) {
  console.error('FAIL missing hello-line', lines);
  process.exit(1);
}
console.log('OK', { code, kinds: lines.map((l) => l.split(':')[0]) });
