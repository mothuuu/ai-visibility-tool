// ---------------------------------------------------------
// AOME | Recommendation Composer (OpenAI + FAQ Library)
// ---------------------------------------------------------
const db = require('../db/connect');
const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function loadFaqs(vertical = 'default', limit = 50) {
  // Try exact vertical, else fallback to default
  const pool = db.getPool();  // ✅ Get pool from db first!
const { rows } = await pool.query(  // ✅ Add 2 spaces here for proper indentation
    `
    SELECT id, vertical, question, answer_human_friendly, answer_factual_backend,
           answer_fallback, schema_jsonld, related_categories, extraction_rules, priority
    FROM faq_library
    WHERE vertical = $1
       OR vertical = 'default'
    ORDER BY CASE WHEN vertical = $1 THEN 0 ELSE 1 END, priority DESC
    LIMIT $2
    `,
    [vertical || 'default', limit]
  );
  return rows;
}

function recommenderSystemPrompt() {
  return `
You are a production-grade AI recommender for the AOME AI Visibility Tool.
Create actionable, EVIDENCE-BASED recommendations aligned to Rubric V5 categories.
Use the provided rubric scores + evidence + FAQ library entries.

Rules:
- Output STRICT JSON array only. No prose.
- Each recommendation must include:
  {
    "category": string,                 // One of the 8 rubric categories
    "severity": "high"|"medium"|"low",
    "text_human": string,               // 60–100 words, polished and friendly
    "text_backend": string,             // facts/stats-heavy with implementable steps
    "faq_refs": string[],               // IDs from the FAQ library used
    "schema_jsonld": string|null,       // JSON-LD string if relevant (FAQPage etc.)
    "alt_questions": string[],          // alternate questions for FAQPage
    "evidence_refs": string[]           // echo back the specific evidence bullets that triggered this
  }

Guardrails:
- No hallucinated data. If evidence is weak, keep text_backend generic and suggest validation steps.
- Prefer recommendations that materially improve low scoring categories.
- If schema_jsonld is present, it must be valid JSON-LD (but keep it short).
- Use 5–8 total recommendations.
`;
}

async function llmComposeRecommendations({ rubric, vertical, domain, faqs, signal }) {
  const messages = [
    { role: 'system', content: recommenderSystemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        domain,
        vertical: vertical || 'default',
        rubric_overall: rubric.overall_score,
        rubric_categories: rubric.categories,
        rubric_evidence: rubric.evidence,
        faq_library_sample: faqs.slice(0, 25) // keep prompt small
      })
    }
  ];

  const resp = await client.chat.completions.create(
    {
      model: 'gpt-4o',
      temperature: 0.3,
      response_format: { type: 'json_object' }, // we will wrap array inside an object for safety
      messages
    },
    { signal }
  );

  const content = resp.choices[0]?.message?.content || '{}';
  // Accept either {"recommendations":[...]} or [...] directly
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  const recs = Array.isArray(parsed) ? parsed : parsed.recommendations;
  return Array.isArray(recs) ? recs : [];
}

/**
 * Main entry
 * @param {object} rubric - result from scorer (overall, categories, evidence, extracted)
 * @param {string} vertical - detected or user-selected, else 'default'
 * @param {string} domain
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Array} recommendations
 */
async function generateRecommendations(rubric, vertical, domain, { signal } = {}) {
  const faqs = await loadFaqs(vertical);
  const recs = await llmComposeRecommendations({ rubric, vertical, domain, faqs, signal });

  // If LLM returned nothing, create a safe minimal rec fallback
  if (!recs || recs.length === 0) {
    return [
      {
        category: "Technical Setup & Structured Data",
        severity: "high",
        text_human:
          "Add structured data (JSON-LD) for your organization and key pages. This helps AI systems and answer engines recognize your brand and services accurately.",
        text_backend:
          "Evidence suggests missing or incomplete structured data. Implement schema.org Organization and relevant page-level schemas. Validate via schema testers.",
        faq_refs: [],
        schema_jsonld: null,
        alt_questions: [],
        evidence_refs: ["No or few <script type=application/ld+json> blocks detected"]
      }
    ];
  }

  // Basic sanitization: cap lengths, ensure required fields present
  const cleaned = recs.map((r) => ({
    category: r.category || "Technical Setup & Structured Data",
    severity: ["high", "medium", "low"].includes((r.severity || "").toLowerCase())
      ? r.severity.toLowerCase()
      : "medium",
    text_human: String(r.text_human || "").slice(0, 900),
    text_backend: String(r.text_backend || "").slice(0, 1200),
    faq_refs: Array.isArray(r.faq_refs) ? r.faq_refs.slice(0, 5) : [],
    schema_jsonld: r.schema_jsonld || null,
    alt_questions: Array.isArray(r.alt_questions) ? r.alt_questions.slice(0, 8) : [],
    evidence_refs: Array.isArray(r.evidence_refs) ? r.evidence_refs.slice(0, 10) : []
  }));

  return cleaned.slice(0, 10);
}

module.exports = { generateRecommendations };
