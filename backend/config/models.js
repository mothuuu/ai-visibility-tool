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

// Perplexity (Citation Monitoring engine). The adapter's default lives here now
// instead of inline; the existing CITATION_PERPLEXITY_MODEL env override is kept.
const DEFAULT_PERPLEXITY_MODEL =
  process.env.CITATION_PERPLEXITY_MODEL || 'llama-3.1-sonar-small-128k-online';

// Cheapest citation-bearing Perplexity model for the Opportunity evidence pass
// (base Sonar, used with low search context). Override via OPPORTUNITY_PERPLEXITY_MODEL.
const OPPORTUNITY_PERPLEXITY_MODEL =
  process.env.OPPORTUNITY_PERPLEXITY_MODEL || 'sonar';

module.exports = {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_OPUS_MODEL,
  DEFAULT_PERPLEXITY_MODEL,
  OPPORTUNITY_PERPLEXITY_MODEL,
};
