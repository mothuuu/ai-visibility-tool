'use strict';

/**
 * Shared LLM-JSON extraction for the draft generators.
 *
 * ONE robust parse path used by every generator (scan_extraction, icps, both
 * competitor columns, prompts) so a model's output-format quirk is handled in a
 * single place. Handles: markdown ```json fences, leading/trailing prose, prose
 * that itself contains brackets, and object-wrapped arrays (e.g. {"icps":[...]}).
 *
 * Also defensive about the adapter result shape: claudeAdapter returns
 * `response_text`, anthropicAdapter returns `response`, and tests may pass a raw
 * string — all are accepted, so a wrong-field read can never silently empty a
 * generator.
 *
 * On total parse failure it returns null (generators keep their graceful-empty
 * fallback) AND logs the raw text at warn level so a future format change is
 * visible without redeploying debug code.
 */

// Pull the text out of whatever shape the adapter returned.
function adapterText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  return String(result.response_text || result.response || result.text || '');
}

// Strip a ```json / ``` fenced block, returning its contents; else the trimmed input.
function stripFences(s) {
  const t = String(s == null ? '' : s).trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : t;
}

// Yield every BALANCED {...} / [...] substring in scan order (quote/escape aware),
// so brackets inside JSON strings and brackets in surrounding prose are handled.
function* balancedSubstrings(s) {
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === open) {
        depth++;
      } else if (c === close) {
        depth--;
        if (depth === 0) { yield s.slice(i, j + 1); break; }
      }
    }
  }
}

// Yield parsed JSON values: a direct parse of the whole (fence-stripped) text
// first, then each balanced substring that parses. Whichever the caller needs.
function* parsedCandidates(rawInput) {
  const text = stripFences(adapterText(rawInput));
  if (!text) return;
  try { yield JSON.parse(text); } catch (_) { /* fall through to substrings */ }
  for (const sub of balancedSubstrings(text)) {
    let v;
    try { v = JSON.parse(sub); } catch (_) { continue; }
    yield v;
  }
}

function warnUnparseable(rawInput, label) {
  const raw = stripFences(adapterText(rawInput)).slice(0, 500).replace(/\s+/g, ' ');
  console.warn(`[draftGen:${label || 'json'}] LLM output could not be parsed as JSON; raw="${raw}"`);
}

// Parse an ARRAY result: first array candidate, or the first array-valued property
// of an object candidate (handles {"icps":[...]} wrapping). null if none.
function parseJsonArray(rawInput, label) {
  for (const v of parsedCandidates(rawInput)) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (Array.isArray(v[k])) return v[k];
      }
    }
  }
  warnUnparseable(rawInput, label);
  return null;
}

// Parse an OBJECT result: first plain-object candidate. null if none.
function parseJsonObject(rawInput, label) {
  for (const v of parsedCandidates(rawInput)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  }
  warnUnparseable(rawInput, label);
  return null;
}

module.exports = { adapterText, stripFences, balancedSubstrings, parseJsonArray, parseJsonObject };
