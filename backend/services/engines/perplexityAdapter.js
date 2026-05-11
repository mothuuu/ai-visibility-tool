/**
 * Perplexity engine adapter for CitationTestService.
 *
 * Uses the OpenAI-compatible endpoint at https://api.perplexity.ai.
 * Calls are made via raw fetch to avoid binding the openai SDK to a third-party host.
 *
 *   runQuery(query, options?) →
 *     { response_text: string, model_used: string, tokens_used: number|null }
 */

const SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer the user\'s question naturally and thoroughly.';

const DEFAULT_MODEL =
  process.env.CITATION_PERPLEXITY_MODEL || 'llama-3.1-sonar-small-128k-online';

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function callOnce(query, model) {
  if (!process.env.PERPLEXITY_API_KEY) {
    throw new Error('Perplexity API key not configured (PERPLEXITY_API_KEY)');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.PERPLEXITY_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: query },
        ],
        max_tokens: 1024,
      }),
      signal: ctl.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      const err = new Error(`Perplexity HTTP ${resp.status}: ${txt.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const tokens = (data.usage && data.usage.total_tokens) || null;
    return { response_text: text, model_used: model, tokens_used: tokens };
  } finally {
    clearTimeout(timer);
  }
}

async function runQuery(query, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const started = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = await callOnce(query, model);
      console.log(`CitationTest [perplexity] query completed in ${Date.now() - started}ms`);
      return out;
    } catch (err) {
      lastErr = err;
      const status = err && err.status;
      if (!isRetryableStatus(status) || attempt === MAX_RETRIES) break;
      const backoff = 500 * Math.pow(2, attempt - 1);
      console.warn(`CitationTest [perplexity] attempt ${attempt} failed (${err.message || err}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr || new Error('Perplexity call failed');
}

module.exports = { runQuery, engine: 'perplexity', defaultModel: DEFAULT_MODEL };
