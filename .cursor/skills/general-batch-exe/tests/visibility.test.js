'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs } = require('../lib/parseArgs');
const { runVerifyCommands } = require('../lib/verify');

describe('console visibility CLI flags', () => {
  it('parses --quiet and --verbose', () => {
    assert.equal(parseArgs(['--quiet']).quiet, true);
    assert.equal(parseArgs(['--verbose']).quiet, false);
    assert.equal(parseArgs(['--quiet', '--verbose']).quiet, false);
  });

  it('parses --no-color', () => {
    assert.equal(parseArgs(['--no-color']).noColor, true);
  });
});

describe('tee child live runner', () => {
  it('teeChild.js exits 0 and writes log for echo script', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-teechild-'));
    const logFile = path.join(tmp, 'out.log');
    const payloadFile = path.join(tmp, 'payload.json');
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("hello-tee\\n")'],
        workdir: tmp,
        logFile,
        heartbeatMs: 60_000,
        label: 'unit',
      }),
    );
    const teeChild = path.join(__dirname, '../lib/agent/teeChild.js');
    const r = spawnSync(process.execPath, [teeChild, payloadFile], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const log = fs.readFileSync(logFile, 'utf8');
    assert.match(log, /hello-tee/);
    assert.match(log, /▶ unit start/);
    assert.match(log, /■ unit done/);
  });

  it('verify live mode records exit 0 for noop', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-verify-live-'));
    const paths = { logs: tmp, reports: path.join(tmp, 'reports') };
    const v = runVerifyCommands(
      ['node -e "process.exit(0)"'],
      tmp,
      paths,
      'unit',
      { quiet: false },
    );
    assert.equal(v.ok, true);
  });

  it('teeChild skips heartbeat while output is flowing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tee-hb-'));
    const logFile = path.join(tmp, 'out.log');
    const payloadFile = path.join(tmp, 'payload.json');
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({
        command: process.execPath,
        args: [
          '-e',
          'let n=0; const t=setInterval(()=>{process.stdout.write("tick\\n"); if(++n>=4){clearInterval(t);}}, 200);',
        ],
        workdir: tmp,
        logFile,
        heartbeatMs: 5_000,
        label: 'unit-hb',
      }),
    );
    const teeChild = path.join(__dirname, '../lib/agent/teeChild.js');
    const r = spawnSync(process.execPath, [teeChild, payloadFile], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const combined = `${r.stdout || ''}${r.stderr || ''}`;
    assert.match(combined, /tick/);
    assert.doesNotMatch(combined, /still running/);
    assert.doesNotMatch(combined, /最近:/);
  });

  it('teeChild emits themed heartbeat with last activity from stream-json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tee-stream-'));
    const logFile = path.join(tmp, 'out.log');
    const payloadFile = path.join(tmp, 'payload.json');
    const ndjson = `${JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      call_id: 'c1',
      tool_call: { readToolCall: { args: { path: 'src/a.ts' } } },
    })}\n`;
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({
        command: process.execPath,
        args: [
          '-e',
          `setTimeout(()=>{process.stdout.write(${JSON.stringify(ndjson)});}, 50);`,
        ],
        workdir: tmp,
        logFile,
        heartbeatMs: 5_000,
        label: 'executor:V2-T1',
        role: 'executor',
        colorEnabled: false,
        outputFormat: 'stream-json',
        showAgentEvents: true,
      }),
    );
    const teeChild = path.join(__dirname, '../lib/agent/teeChild.js');
    const r = spawnSync(process.execPath, [teeChild, payloadFile], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const combined = `${r.stdout || ''}${r.stderr || ''}`;
    assert.match(combined, /读取/);
    assert.match(combined, /src\/a\.ts/);
  });

  it('teeChild heartbeatMs 0 never heartbeats', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbx-tee-nohb-'));
    const logFile = path.join(tmp, 'out.log');
    const payloadFile = path.join(tmp, 'payload.json');
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({
        command: process.execPath,
        args: ['-e', 'setTimeout(()=>process.stdout.write("done\\n"), 100)'],
        workdir: tmp,
        logFile,
        heartbeatMs: 0,
        label: 'unit-nohb',
      }),
    );
    const teeChild = path.join(__dirname, '../lib/agent/teeChild.js');
    const r = spawnSync(process.execPath, [teeChild, payloadFile], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.doesNotMatch(`${r.stdout || ''}${r.stderr || ''}`, /still running/);
  });
});
