'use strict';

/**
 * Module: mergeConfig
 * Purpose: Merge defaults < project config < exFile frontmatter < CLI overrides.
 */

const DEFAULTS = {
  batch_size: 3,
  max_rounds: 40,
  max_fix_attempts: 5,
  max_full_fix_attempts: 5,
  /** Scripts green but tasks still ⬜ — separate from hard verify fix budget. */
  max_checkbox_fix_attempts: 2,
  stop_on_fail: true,
  group: 'order',
  verify_default: [],
  read_first: [],
  hard_stop_patterns: [],
  executor_extra: '',
  reviewer_extra: '',
  fixer_extra: '',
  final_reviewer_extra: '',
  workflow_dir: '.ai-workflow',
  adapter: null,
  /** Default OFF: must pass --checkpoint to enable. */
  enable_checkpoint: false,
  /** If checkpoint enabled, refuse dirty worktrees (recommended). */
  checkpoint_require_clean: true,
  /** Executor non-zero exit → BLOCKED unless true. */
  continue_on_executor_fail: false,
  agent: {
    command: process.env.GBX_AGENT_CMD || 'cursor-agent',
    print_flag: '-p',
    /** stream-json enables live tool_call activity lines in teeChild. */
    output_format: 'stream-json',
    stream_partial_output: false,
    /** cursor-agent --force: auto-approve shell/delete in headless batch runs. */
    force: process.env.GBX_AGENT_FORCE !== '0' && process.env.GBX_AGENT_FORCE !== 'false',
    /** cursor-agent --trust: trust workspace without interactive prompt. */
    trust: process.env.GBX_AGENT_TRUST !== '0' && process.env.GBX_AGENT_TRUST !== 'false',
    /** cursor-agent --approve-mcps (off by default). */
    approve_mcps: process.env.GBX_AGENT_APPROVE_MCPS === '1' || process.env.GBX_AGENT_APPROVE_MCPS === 'true',
    /** cursor-agent --sandbox enabled|disabled (null = omit flag). */
    sandbox: null,
  },
  console_ui: {
    /** auto | tui | plain — auto enables TUI when stderr is a TTY (Windows defaults plain) */
    mode:
      process.env.GBX_TUI === '0' || process.env.GBX_TUI === 'false' || process.platform === 'win32'
        ? 'plain'
        : process.env.GBX_TUI === '1' || process.env.GBX_TUI === 'true'
          ? 'tui'
          : 'auto',
    /** Default off so terminal-native text selection remains available. */
    mouse: false,
    show_shortcuts: true,
  },
  console_theme: {
    enabled: true,
    color: true,
    show_role_banner: true,
    show_agent_events: true,
  },
  /** false = live tee + heartbeats (default). true = capture-only. */
  quiet: false,
  heartbeat_ms: 15_000,
  /** Same verify fingerprint failures before BLOCKED (even if fix budget remains). */
  max_ineffective_fixes: 2,
  verify_capture_max_bytes: 65536,
  /**
   * A fresh analyzer/resolver pair gets a separate, tightly bounded budget after
   * ordinary Fixer attempts are exhausted. This widens diagnostic context, not
   * operating-system permissions.
   */
  block_recovery: {
    enabled: true,
    max_attempts: 2,
    min_confidence: 'high',
    require_declared_scope: false,
    dependency_policy: 'declared-only',
    allowed_kinds: [
      'INDEX_SCHEMA_CORRUPTION',
      'HARD_STOP_FALSE_POSITIVE',
      'FIXER_ACCUMULATION',
      'IN_SCOPE_VERIFY',
      'PROJECT_DEPENDENCY_MISSING',
    ],
    deny_paths: [
      '.cursor/skills/general-batch-exe/**',
    ],
    task_scopes: {},
    analyzer_extra: '',
    resolver_extra: '',
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  if (!isPlainObject(over)) {
    return base;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === null) {
      continue;
    }
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {object} options
 * @param {object} [options.projectConfig] from --config yaml
 * @param {object} [options.frontmatter] from exFile
 * @param {object} [options.cli] selected CLI overrides
 */
function mergeConfig({ projectConfig = {}, frontmatter = {}, cli = {} } = {}) {
  let cfg = deepMerge(DEFAULTS, projectConfig);
  cfg = deepMerge(cfg, frontmatter);

  if (cli.agentCmd) {
    cfg.agent = { ...cfg.agent, command: cli.agentCmd };
  }
  if (cli.noAgentForce === true) {
    cfg.agent = { ...cfg.agent, force: false };
  }
  if (cli.noAgentTrust === true) {
    cfg.agent = { ...cfg.agent, trust: false };
  }
  if (cli.maxIterations != null && !Number.isNaN(cli.maxIterations)) {
    cfg.max_rounds = cli.maxIterations;
  }
  // Checkpoint: default off. --checkpoint enables; --no-checkpoint forces off.
  if (cli.checkpoint === true) {
    cfg.enable_checkpoint = true;
  }
  if (cli.noCheckpoint === true) {
    cfg.enable_checkpoint = false;
  }
  if (cli.mockAgent) {
    cfg.mock_agent = true;
  }
  if (cli.continueOnExecutorFail === true) {
    cfg.continue_on_executor_fail = true;
  }
  if (cli.quiet === true) {
    cfg.quiet = true;
  }
  if (cli.quiet === false) {
    cfg.quiet = false;
  }
  if (cli.noHeartbeat === true) {
    cfg.heartbeat_ms = 0;
  }
  if (cli.noColor === true) {
    cfg.console_theme = { ...cfg.console_theme, color: false };
  }
  if (cli.consoleUi) {
    cfg.console_ui = { ...cfg.console_ui, mode: cli.consoleUi };
  }
  if (cli.plainConsole === true) {
    cfg.console_ui = { ...cfg.console_ui, mode: 'plain' };
  }
  if (cli.tui === true) {
    cfg.console_ui = { ...cfg.console_ui, mode: 'tui' };
  }

  return cfg;
}

module.exports = { DEFAULTS, mergeConfig, deepMerge };
