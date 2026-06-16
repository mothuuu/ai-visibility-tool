// backend/services/engines/anthropicAdapter.js
// AbortSignal cancellation is enforced via Promise.race. Underlying axios requests
// may continue in-flight after the signal fires; only timeout enforcement is guaranteed.
const axios = require('axios');

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = require('../../config/models').DEFAULT_CLAUDE_MODEL;

async function runQuery(prompt, options = {}) {
  const { timeout = 30000, signal } = options;
  const start = Date.now();

  const requestPromise = axios.post(
    ENDPOINT,
    { model: MODEL, max_tokens: 500, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      timeout
    }
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

  const usage = resp.data?.usage;
  const tokensUsed = usage ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) : null;

  return {
    response: resp.data?.content?.[0]?.text || '',
    model: MODEL,
    tokensUsed,
    latencyMs: Date.now() - start
  };
}

module.exports = { runQuery };
