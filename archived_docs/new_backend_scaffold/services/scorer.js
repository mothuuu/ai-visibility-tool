// ---------------------------------------------------------
// AOME | Rubric V5 Scorer (OpenAI-powered)
// ---------------------------------------------------------
const { pool } = require('../db/connect');
const OpenAI = require('openai');
const { TIMEOUTS, isAbortError } = require('../utils/withTimeout');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Fetch with a hard timeout. Honours an optional parent `signal` so the
// request-level deadline can abort an in-flight page fetch.
async function fetchWithTimeout(url, { ms = TIMEOUTS.FETCH_MS, signal } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);

  const onParentAbort = () => controller.abort(signal && signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AOME-Scanner/1.0' },
    });
    const text = await res.text();
    return { ok: true, status: res.status, html: text };
  } catch (err) {
    // Propagate aborts so the caller can map them to UPSTREAM_TIMEOUT.
    // Network errors continue to surface as a graceful fallback object.
    if (isAbortError(err)) throw err;
    return { ok: false, status: 0, error: err.message };
  } finally {
    clearTimeout(id);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}

// Very light HTML feature extraction (cheap pre-processing)
function extractSignals(html) {
  const take = (re, d = '') => (html.match(re) || [d])[1] || d;
  const count = (re) => (html.match(re) || []).length;

  const title = take(/<title[^>]*>([^<]{0,300})<\/title>/i);
  const metaDesc = take(/<meta\s+name=["']description["']\s+content=["']([^"']{0,400})["']/i);
  const h1 = count(/<h1\b[^>]*>/gi);
  const h2 = count(/<h2\b[^>]*>/gi);
  const ldjsonBlocks = (html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []).length;
  const robotsNoindex = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
  const links = count(/<a\b[^>]*href=/gi);
  const imgs = count(/<img\b[^>]*>/gi);
  const imgsWithAlt = count(/<img\b[^>]*\balt=["'][^"']+["']/gi);
  const words = (html.replace(/<[^>]+>/g, ' ').match(/\b\w+\b/g) || []).length;

  return {
    title, metaDesc, h1, h2, ldjsonBlocks, robotsNoindex,
    links, imgs, imgsWithAlt, words
  };
}

function rubricSystemPrompt() {
  return `
You are an AI auditor scoring a web page's AI Visibility using the Enhanced AI Readiness Rubric V5.
Return STRICT JSON only. No prose. Scoring must sum to 100 with the following max weights:

1. AI Search Readiness & Content Depth (20)
2. Content Structure & Entity Recognition (15)
3. Voice & Conversational Optimization (12)
4. Technical Setup & Structured Data (18)
5. Trust, Authority & Verification (12)
6. AI Readability & Multimodal Access (10)
7. Content Freshness & Maintenance (8)
8. Speed & User Experience (5)

Also return short evidence bullets per category from the provided extracted signals + HTML snippet (no speculation).

JSON schema:
{
  "overall_score": number,
  "categories": {
    "AI Search Readiness & Content Depth": number,
    "Content Structure & Entity Recognition": number,
    "Voice & Conversational Optimization": number,
    "Technical Setup & Structured Data": number,
    "Trust, Authority & Verification": number,
    "AI Readability & Multimodal Access": number,
    "Content Freshness & Maintenance": number,
    "Speed & User Experience": number
  },
  "evidence": {
    "AI Search Readiness & Content Depth": string[],
    "Content Structure & Entity Recognition": string[],
    "Voice & Conversational Optimization": string[],
    "Technical Setup & Structured Data": string[],
    "Trust, Authority & Verification": string[],
    "AI Readability & Multimodal Access": string[],
    "Content Freshness & Maintenance": string[],
    "Speed & User Experience": string[]
  }
}
Return ONLY that JSON.
`;
}

async function llmScorePage({ url, signals, htmlSample, signal }) {
  const prompt = [
    {
      role: 'system',
      content: rubricSystemPrompt()
    },
    {
      role: 'user',
      content: JSON.stringify({
        url,
        extracted_signals: signals,
        html_sample: htmlSample
      })
    }
  ];

  const resp = await client.chat.completions.create(
    {
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: prompt
    },
    // SDK request options: forward the abort signal so a request-level
    // deadline cancels the in-flight HTTPS request.
    { signal }
  );

  return resp.choices[0]?.message?.content || '{}';
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/**
 * Main entry
 * @param {string} url
 * @param {{signal?: AbortSignal}} [opts]
 * @returns { overall_score, categories, evidence, extracted }
 */
async function runRubricScoring(url, { signal } = {}) {
  const fetched = await fetchWithTimeout(url, { signal });
  if (!fetched.ok) {
    // Graceful fallback if fetch fails
    return {
      overall_score: 0,
      categories: {
        "AI Search Readiness & Content Depth": 0,
        "Content Structure & Entity Recognition": 0,
        "Voice & Conversational Optimization": 0,
        "Technical Setup & Structured Data": 0,
        "Trust, Authority & Verification": 0,
        "AI Readability & Multimodal Access": 0,
        "Content Freshness & Maintenance": 0,
        "Speed & User Experience": 0
      },
      evidence: {
        "AI Search Readiness & Content Depth": ["Page fetch failed"],
        "Content Structure & Entity Recognition": [],
        "Voice & Conversational Optimization": [],
        "Technical Setup & Structured Data": [],
        "Trust, Authority & Verification": [],
        "AI Readability & Multimodal Access": [],
        "Content Freshness & Maintenance": [],
        "Speed & User Experience": []
      },
      extracted: { fetch_status: fetched.status }
    };
  }

  const html = fetched.html || '';
  const signals = extractSignals(html);
  const htmlSample = html.slice(0, 8000); // keep token usage sane

  const raw = await llmScorePage({ url, signals, htmlSample, signal });
  const parsed = safeJsonParse(raw);

  if (!parsed || !parsed.categories) {
    // Conservative fallback if model returns bad JSON
    return {
      overall_score: 50,
      categories: {
        "AI Search Readiness & Content Depth": 10,
        "Content Structure & Entity Recognition": 8,
        "Voice & Conversational Optimization": 6,
        "Technical Setup & Structured Data": 10,
        "Trust, Authority & Verification": 6,
        "AI Readability & Multimodal Access": 5,
        "Content Freshness & Maintenance": 3,
        "Speed & User Experience": 2
      },
      evidence: {
        "AI Search Readiness & Content Depth": ["Fallback scoring applied"],
        "Content Structure & Entity Recognition": [],
        "Voice & Conversational Optimization": [],
        "Technical Setup & Structured Data": [],
        "Trust, Authority & Verification": [],
        "AI Readability & Multimodal Access": [],
        "Content Freshness & Maintenance": [],
        "Speed & User Experience": []
      },
      extracted: { ...signals, fetch_status: fetched.status }
    };
  }

  return { ...parsed, extracted: { ...signals, fetch_status: fetched.status } };
}

module.exports = { runRubricScoring };
