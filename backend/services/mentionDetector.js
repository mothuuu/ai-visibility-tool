'use strict';

// backend/services/mentionDetector.js
// Uses Claude Haiku to classify brand mentions in AI-generated responses.
// Always returns — never throws. On any failure returns FALLBACK with detectionStatus:'failed'.

const Anthropic = require('@anthropic-ai/sdk');

const MAX_RESPONSE_CHARS = 4000;
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 512;

const FALLBACK = Object.freeze({
  mentioned: false,
  recommended: false,
  cited: false,
  snippet: null,
  reasoning: null,
  detectionStatus: 'failed',
});

// Preserve beginning (60%) and middle (40%) of long responses.
// Brand mentions appear early in AI answers; middle captures elaboration.
// End-of-response caveats are dropped — least useful for brand detection.
function prepareResponseText(text) {
  if (!text) return '';
  if (text.length <= MAX_RESPONSE_CHARS) return text;
  const headLen = Math.ceil(MAX_RESPONSE_CHARS * 0.6);
  const midStart = Math.floor(text.length / 2);
  const midLen = MAX_RESPONSE_CHARS - headLen;
  return text.slice(0, headLen) + '\n[...]\n' + text.slice(midStart, midStart + midLen);
}

function isValidSchema(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.mentioned === 'boolean' &&
    typeof obj.recommended === 'boolean' &&
    typeof obj.cited === 'boolean' &&
    (obj.snippet === null || typeof obj.snippet === 'string') &&
    (obj.reasoning === null || typeof obj.reasoning === 'string')
  );
}

async function detectMention(responseText, brandContext) {
  const { companyName, domain } = brandContext || {};
  const truncated = prepareResponseText(responseText);

  const prompt =
    'You are a brand-mention classifier. Analyze the AI-generated response below.\n' +
    'Return a JSON object only — no preamble, no markdown, no backticks.\n\n' +
    `Brand to detect:\n- Company name: ${companyName || '(unknown)'}\n` +
    `- Domain: ${domain || '(unknown)'}\n\n` +
    `AI response:\n${truncated}\n\n` +
    'Return exactly this JSON schema:\n' +
    '{\n' +
    '  "mentioned": <boolean — true if the company name or domain appears in the response>,\n' +
    '  "recommended": <boolean — true if the brand is recommended or ranked positively>,\n' +
    '  "cited": <boolean — true if the brand URL or domain is cited as a source>,\n' +
    '  "snippet": <string|null — verbatim 50-100 word excerpt from the response showing where\n' +
    '    the brand appeared, or where competitors were named if the brand was absent;\n' +
    '    null if no relevant excerpt can be found in the text above>,\n' +
    '  "reasoning": <string|null — your internal explanation of the classification>\n' +
    '}\n\n' +
    'IMPORTANT: snippet must be copied verbatim from the response text — never paraphrase or invent text.\n' +
    'Return only the JSON object. No other text.';

  const client = new Anthropic();

  try {
    const message = await client.messages.create(
      {
        model: 'claude-haiku-4-5',
        max_tokens: MAX_TOKENS,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: TIMEOUT_MS }
    );

    const raw = (message.content[0]?.text || '').trim();
    // Strip any accidental markdown fence the model may prepend or append.
    const clean = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.error('[mentionDetector] JSON parse failed:', parseErr.message);
      return { ...FALLBACK };
    }

    if (!isValidSchema(parsed)) {
      console.error('[mentionDetector] schema validation failed');
      return { ...FALLBACK };
    }

    return {
      mentioned: parsed.mentioned,
      recommended: parsed.recommended,
      cited: parsed.cited,
      snippet: parsed.snippet,
      reasoning: parsed.reasoning,
      detectionStatus: 'detected',
    };
  } catch (err) {
    console.error('[mentionDetector] Anthropic call failed:', err.message || String(err.status));
    return { ...FALLBACK };
  }
}

module.exports = { detectMention };
