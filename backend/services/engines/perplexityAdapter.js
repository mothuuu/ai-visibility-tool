// backend/services/engines/perplexityAdapter.js
// AbortSignal cancellation is enforced via Promise.race. Underlying axios requests
// may continue in-flight after the signal fires; only timeout enforcement is guaranteed.
const axios = require('axios');

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const MODEL = 'llama-3.1-sonar-small-128k-online';

async function runQuery(prompt, options = {}) {
  const { timeout = 30000, signal } = options;
  const start = Date.now();

  const requestPromise = axios.post(
    ENDPOINT,
    { model: MODEL, messages: [{ role: 'user', content: prompt }] },
    { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' }, timeout }
  );

  let resp;
  if (signal) {
    const abortPromise = new Promise((_, reject) => {
      if (signal.aborted) return reject(new Error('Request aborted'));
      signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
    });
    resp = await Promise.race([requestPromise, abortPromise]);
  } else {
    resp = await requestPromise;
  }

  return {
    response: resp.data?.choices?.[0]?.message?.content || '',
    model: MODEL,
    tokensUsed: resp.data?.usage?.total_tokens ?? null,
    latencyMs: Date.now() - start
  };
}

module.exports = { runQuery };
