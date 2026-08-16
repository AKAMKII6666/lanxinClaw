'use strict';

/**
 * Module: agent/cursorStream
 * Purpose: Parse cursor-agent --output-format stream-json NDJSON into human activity lines.
 */

const { relPath, truncateText } = require('../consoleTheme');

const TOOL_LABELS = {
  readToolCall: '读取',
  writeToolCall: '写入',
  editToolCall: '编辑',
  shellToolCall: '运行',
  grepToolCall: '搜索',
  lsToolCall: '列目录',
  globToolCall: '匹配',
  deleteToolCall: '删除',
  todoToolCall: '待办',
};

function toolKind(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return null;
  return Object.keys(toolCall).find((k) => k.endsWith('ToolCall')) || null;
}

function toolArgs(toolCall, kind) {
  return toolCall && kind ? toolCall[kind]?.args || {} : {};
}

/**
 * Format a tool_call started event as a short activity string.
 * @param {object} event
 * @param {string} [workdir]
 */
function formatToolCallStarted(event, workdir) {
  const kind = toolKind(event.tool_call);
  if (!kind) return null;
  const args = toolArgs(event.tool_call, kind);
  const label = TOOL_LABELS[kind] || kind.replace(/ToolCall$/, '');
  if (kind === 'readToolCall' || kind === 'writeToolCall' || kind === 'editToolCall' || kind === 'deleteToolCall') {
    return `${label} ${relPath(args.path, workdir)}`;
  }
  if (kind === 'shellToolCall') {
    const cmd = args.command || args.cmd || args.shellCommand || '';
    return `${label} ${truncateText(cmd, 72)}`;
  }
  if (kind === 'grepToolCall') {
    const pattern = args.pattern || args.query || '';
    const inPath = args.path ? ` in ${relPath(args.path, workdir)}` : '';
    return `${label} ${truncateText(pattern, 40)}${inPath}`;
  }
  if (kind === 'lsToolCall' || kind === 'globToolCall') {
    return `${label} ${relPath(args.path || args.glob_pattern || args.pattern, workdir)}`;
  }
  return label;
}

function assistantText(event) {
  const content = event.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('');
}

/**
 * Whether to emit assistant preview (skip buffered duplicate flushes).
 * @param {object} event
 * @param {boolean} streamPartial
 */
function shouldEmitAssistant(event, streamPartial) {
  if (event.type !== 'assistant') return false;
  const text = assistantText(event).trim();
  if (!text) return false;
  if (!streamPartial) {
    return true;
  }
  // Streaming delta: has timestamp_ms, no model_call_id
  if (event.timestamp_ms != null && event.model_call_id == null) {
    return true;
  }
  return false;
}

/**
 * @param {string} line raw NDJSON line
 * @param {{ workdir?: string, streamPartial?: boolean, showAssistant?: boolean }} opts
 * @returns {Array<{ type: 'activity'|'result'|'assistant', text: string }>}
 */
function processLine(line, opts = {}) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('{')) return [];
  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const out = [];
  if (event.type === 'tool_call' && event.subtype === 'started') {
    const text = formatToolCallStarted(event, opts.workdir);
    if (text) out.push({ type: 'activity', text });
    return out;
  }
  if (event.type === 'result' && event.subtype === 'success' && event.result) {
    out.push({ type: 'result', text: String(event.result) });
    return out;
  }
  if (opts.showAssistant !== false && shouldEmitAssistant(event, Boolean(opts.streamPartial))) {
    const text = truncateText(assistantText(event), 120);
    if (text) out.push({ type: 'assistant', text: `思考 ${text}` });
  }
  return out;
}

module.exports = {
  formatToolCallStarted,
  processLine,
  toolKind,
};
