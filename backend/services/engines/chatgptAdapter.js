/**
 * ChatGPT (OpenAI) engine adapter for CitationTestService.
 *
 *   runQuery(query, options?) →
 *     { response: string, model_used: string, tokens_used: number|null }
 *
 * Retries on 429 / 5xx with exponential backoff, up to 3 attempts.
 * 30 s per-call timeout.
 */

const SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer the user\'s question naturally and thoroughly.';

const DEFAULT_MODEL =
  process.env.CITATION_OPENAI_MODEL || 'gpt-4o-mini';

const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured (OPENAI_API_KEY)');
  }
  const OpenAI = require('openai');
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS });
  return _client;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryable(err) {
  const status = err && (err.status || (err.response && err.response.status));
  return status === 429 || (status >= 500 && status < 600);
}

async function callOnce(query, model) {
  const client = getClient();
  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: query },
    ],
    max_tokens: 1024,
  });
  const text = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
  const tokens = (resp.usage && resp.usage.total_tokens) || null;
  return { response: text, model_used: model, tokens_used: tokens };
}

async function runQuery(query, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const started = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = await callOnce(query, model);
      console.log(`CitationTest [chatgpt] query completed in ${Date.now() - started}ms`);
      return out;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;
      const backoff = 500 * Math.pow(2, attempt - 1);
      console.warn(`CitationTest [chatgpt] attempt ${attempt} failed (${err.message || err}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr || new Error('OpenAI call failed');
}

module.exports = { runQuery, engine: 'chatgpt', defaultModel: DEFAULT_MODEL };
