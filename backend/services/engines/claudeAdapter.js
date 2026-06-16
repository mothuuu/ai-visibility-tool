/**
 * Claude (Anthropic) engine adapter for CitationTestService.
 *
 *   runQuery(query, options?) →
 *     { response_text: string, model_used: string, tokens_used: number|null }
 *
 * Retries on 429 (rate limit) and 5xx with exponential backoff, up to 3 attempts.
 * 30 s per-call timeout.
 */

const SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer the user\'s question naturally and thoroughly.';

const DEFAULT_MODEL =
  process.env.CITATION_CLAUDE_MODEL || require('../../config/models').DEFAULT_CLAUDE_MODEL;

const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic API key not configured (ANTHROPIC_API_KEY)');
  }
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryable(err) {
  const status = err && (err.status || (err.response && err.response.status));
  return status === 429 || (status >= 500 && status < 600);
}

async function callOnce(query, model) {
  const client = getClient();
  // Race against a timeout
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: query }],
    }, { signal: ctl.signal });
    const block = (resp.content || []).find(b => b.type === 'text');
    const text = block && typeof block.text === 'string' ? block.text : '';
    const usage = resp.usage || {};
    const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0) || null;
    return { response_text: text, model_used: model, tokens_used: totalTokens };
  } finally {
    clearTimeout(t);
  }
}

async function runQuery(query, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const started = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = await callOnce(query, model);
      console.log(`CitationTest [claude] query completed in ${Date.now() - started}ms`);
      return out;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;
      const backoff = 500 * Math.pow(2, attempt - 1); // 500, 1000, 2000
      console.warn(`CitationTest [claude] attempt ${attempt} failed (${err.message || err}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr || new Error('Claude call failed');
}

module.exports = { runQuery, engine: 'claude', defaultModel: DEFAULT_MODEL };
