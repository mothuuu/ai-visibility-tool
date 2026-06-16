/**
 * LLM model configuration — single source of truth for default model IDs.
 *
 * Change the default model HERE (or via the CLAUDE_MODEL / CLAUDE_OPUS_MODEL env
 * vars) — do NOT hardcode model strings at call sites. Individual call sites may
 * still keep a site-specific override env var, but their fallback default must
 * come from here so a model retirement is a one-place change.
 *
 * History: claude-sonnet-4-20250514 and claude-opus-4-20250514 were retired from
 * the Anthropic API on 2026-06-15.
 */

const DEFAULT_CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const DEFAULT_CLAUDE_OPUS_MODEL = process.env.CLAUDE_OPUS_MODEL || 'claude-opus-4-8';

module.exports = {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_OPUS_MODEL,
};
