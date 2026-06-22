/**
 * Perplexity adapter — citation surfacing + config-sourced model.
 *
 *   node --test backend/tests/unit/perplexity-adapter-citations.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const models = require('../../config/models');
const adapter = require('../../services/engines/perplexityAdapter');

const realFetch = global.fetch;
let lastFetch = null;

function stubFetch(jsonBody) {
  global.fetch = async (url, opts) => {
    lastFetch = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => jsonBody, text: async () => '' };
  };
}

beforeEach(() => {
  process.env.PERPLEXITY_API_KEY = 'test-key';
  lastFetch = null;
});
afterEach(() => { global.fetch = realFetch; });

describe('perplexityAdapter — citations', () => {
  it('surfaces full citation URLs from top-level `citations`', async () => {
    stubFetch({
      choices: [{ message: { content: 'answer' } }],
      usage: { total_tokens: 42 },
      citations: ['https://acme.com/x', 'https://g2.com/y'],
    });
    const out = await adapter.runQuery('best crm');
    assert.deepStrictEqual(out.citations, ['https://acme.com/x', 'https://g2.com/y']);
    // Existing callers unaffected: response + tokens still present.
    assert.strictEqual(out.response, 'answer');
    assert.strictEqual(out.tokens_used, 42);
  });

  it('falls back to `search_results[].url` when `citations` absent', async () => {
    stubFetch({
      choices: [{ message: { content: 'a' } }],
      search_results: [{ url: 'https://c.com', title: 'C' }, { url: 'https://d.com' }],
    });
    const out = await adapter.runQuery('q');
    assert.deepStrictEqual(out.citations, ['https://c.com', 'https://d.com']);
  });

  it('returns [] when the response carries no citations', async () => {
    stubFetch({ choices: [{ message: { content: 'a' } }], usage: { total_tokens: 1 } });
    const out = await adapter.runQuery('q');
    assert.deepStrictEqual(out.citations, []);
  });

  it('model default is sourced from config/models.js', async () => {
    assert.strictEqual(adapter.defaultModel, models.DEFAULT_PERPLEXITY_MODEL);
    stubFetch({ choices: [{ message: { content: 'a' } }] });
    await adapter.runQuery('q');
    assert.strictEqual(lastFetch.body.model, models.DEFAULT_PERPLEXITY_MODEL, 'no hardcoded model at call site');
  });

  it('low search context is opt-in (sent only when requested)', async () => {
    stubFetch({ choices: [{ message: { content: 'a' } }] });
    await adapter.runQuery('q');
    assert.ok(!('web_search_options' in lastFetch.body), 'no search context by default — existing behaviour unchanged');

    await adapter.runQuery('q', { searchContextSize: 'low' });
    assert.deepStrictEqual(lastFetch.body.web_search_options, { search_context_size: 'low' });
  });
});
