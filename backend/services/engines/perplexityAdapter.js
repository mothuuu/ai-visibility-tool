/**
 * Perplexity engine adapter for CitationTestService.
 *
 * Uses the OpenAI-compatible endpoint at https://api.perplexity.ai.
 * Calls are made via raw fetch to avoid binding the openai SDK to a third-party host.
 *
 *   runQuery(query, options?) →
 *     { response: string, model_used: string, tokens_used: number|null, citations: string[] }
 *
 * `citations` is the list of FULL source URLs Perplexity returns for the answer
 * (always an array; [] when the response carries none). Older callers that read
 * only `response` / `tokens_used` are unaffected by the added field.
 *
 * options.searchContextSize ('low'|'medium'|'high') maps to Perplexity's
 * web_search_options.search_context_size — only sent when provided (default
 * behaviour unchanged). 'low' is the cheapest and is used by the Opportunity
 * evidence pass.
 */

const SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer the user\'s question naturally and thoroughly.';

const DEFAULT_MODEL = require('../../config/models').DEFAULT_PERPLEXITY_MODEL;

// Pull the citation URLs out of whatever shape Perplexity returns. Top-level
// `citations` (array of URL strings) is the documented field; `search_results`
// (array of {url,title}) is the newer shape. Returns [] when neither is present.
function extractCitations(data) {
  if (data && Array.isArray(data.citations)) {
    return data.citations.filter((c) => typeof c === 'string' && c.trim());
  }
  if (data && Array.isArray(data.search_results)) {
    return data.search_results.map((r) => r && r.url).filter((u) => typeof u === 'string' && u.trim());
  }
  return [];
}

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function callOnce(query, model, searchContextSize) {
  if (!process.env.PERPLEXITY_API_KEY) {
    throw new Error('Perplexity API key not configured (PERPLEXITY_API_KEY)');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const body = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: query },
      ],
      max_tokens: 1024,
    };
    // Opt-in only: cap search context (cost) when the caller asks. Absent => unchanged.
    if (searchContextSize) {
      body.web_search_options = { search_context_size: searchContextSize };
    }
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.PERPLEXITY_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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
    return { response: text, model_used: model, tokens_used: tokens, citations: extractCitations(data) };
  } finally {
    clearTimeout(timer);
  }
}

async function runQuery(query, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const searchContextSize = options.searchContextSize || null;
  const started = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = await callOnce(query, model, searchContextSize);
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
