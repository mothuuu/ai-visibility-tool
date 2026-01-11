# Visible2AI — Recommendation Generation Spec

**Document:** `18-recommendation-generation-spec.md`  
**Status:** Canonical (Phase 0 contract)  
**Last updated:** 2026-01-11  
**Scope:** How Visible2AI turns detection + evidence into **high-quality, marketing-first** recommendations (site-first, page-optional).  

**This is NOT** the progressive unlock/cadence spec (see `17-progressive-unlock-spec.md`). This spec defines **what gets generated, how it's written, how overlap is handled, and how quality is enforced**.

---

## 0. Goals

1. **Actionable, non-technical by default**: Users should understand what to do and why it matters without jargon.
2. **Evidence-based**: Recommendations must be grounded in captured signals (no hallucinated findings).
3. **No overlaps / no noise**: Avoid multiple recommendations that say the same thing across pillars.
4. **Audience views**: Marketing-first default; technical + exec views are opt-in.
5. **Consistent structure**: Same "shape" across all recs enables UI consistency, exports, and future automation.
6. **Industry-aware**: Leverage industry-specific FAQ libraries, certifications, and schema mappings.

---

## 1. Inputs

### 1.1 Required Inputs (Per Scan)
- `scores` (site-level 8 pillars + optional subfactors; canonical scale per scoring contract)
- `evidence` (selectors + extracted text/snippets + URLs + timestamps)
- `detection_results` (rule IDs, pass/fail, confidence)
- `site_context`:
  - `domain`, `brand_name` (if known)
  - primary language (detected)
  - market/industry (if known; from onboarding/profile)
  - plan entitlements (for what to show vs lock)

### 1.2 Optional Inputs
- `page_context` (only if page-optional is enabled): page URL, template type, page role
- `user_profile` / `org_profile`: role, ICP, region, goals, product category, **company_type**
- `citation_signals` (if available): external mentions, backlinks, directory coverage

---

## 2. Outputs

### 2.1 Recommendation Object (Canonical)
Each recommendation MUST be generated as a structured object, even if UI shows only part.

**Required Fields**
| Field | Type | Description |
|-------|------|-------------|
| `dedup_key` | TEXT | Stable key, prevents duplicates across scans |
| `pillar_key` | TEXT | One of the 8 canonical pillars |
| `type` | ENUM | `actionable` \| `diagnostic` |
| `title` | TEXT | Short headline (≤80 chars) |
| `priority` | ENUM | `p0` \| `p1` \| `p2` |
| `impact` | ENUM | `high` \| `medium` \| `low` |
| `effort` | ENUM | `low` \| `medium` \| `high` |
| `confidence_score` | NUMERIC | 0–1, derived from evidence coverage + rule confidence |
| `evidence` | JSONB | URLs, selectors, rule_ids, notes |
| `marketing_copy` | TEXT | Default view (required, non-empty) |
| `technical_copy` | TEXT | Optional expanded view |
| `exec_copy` | TEXT | Optional executive view |

**Recommended Fields**
| Field | Type | Description |
|-------|------|-------------|
| `why_it_matters` | TEXT | 1–2 short paragraphs |
| `what_to_do` | TEXT | Bullet list of actions |
| `how_to_do` | TEXT | Step list (no code by default) |
| `expected_gain` | TEXT | e.g., "+40–80 points in Speak AI's Language" |
| `proof_points` | TEXT | What will change after implementation |
| `related_cluster_id` | TEXT | For overlap grouping |
| `engine_version` | TEXT | e.g., `rec_v2` |
| `language` | TEXT | ISO code of the copy returned |
| `suggested_faqs` | JSONB | Industry-specific FAQ suggestions (if applicable) |
| `suggested_schema` | JSONB | Industry-specific schema recommendations (if applicable) |
| `suggested_certifications` | JSONB | Industry-expected certifications (if applicable) |

### 2.2 Audience Views (Contract)
- **Default**: `marketing_copy` (WHY + WHAT)
- **Expand**: `technical_copy` (HOW, tools, validation steps)
- **Exec**: `exec_copy` (ROI, risk, effort, timeline, ownership)

---

## 3. Pillar Naming (Marketing Headline + Technical Label)

Visible2AI keeps the canonical 8 pillars for external consistency, but the UI should show a marketing-first headline.

**Display format:**
- **Headline (marketing)** on top
- *Pillar (technical label)* as a subheading

**Mapping**

| Pillar Key | Marketing Headline | Technical Label |
|------------|-------------------|-----------------|
| `schema_markup` | **Speak AI's Language** | Schema Markup |
| `entity_recognition` | **Be THE Answer** | Entity Recognition |
| `content_structure` | **Content AI Can Use** | Content Structure |
| `trust_authority` | **Be Trusted** | Trust & Authority |
| `citation_worthiness` | **Be Worth Quoting** | Citation Worthiness |
| `voice_optimization` | **Own the Conversation** | Voice Optimization |
| `speed_ux` | **Fast & Friendly** | Speed & UX |
| `technical_setup` | **Solid Foundation** | Technical Setup |

---

## 4. Generation Pipeline (Stages)

### Stage A — Candidate Issue Creation (Deterministic)
**Source:** Detection rules + thresholds + evidence coverage.

- Convert failed rules and low-score areas into **issue candidates**
- Each candidate must include:
  - triggering `rule_ids`
  - supporting evidence summary
  - affected pillar/subfactor
  - initial priority estimate

**Rule:** If an issue cannot be backed by evidence, it must become a **diagnostic** (not actionable).

### Stage B — Candidate Enrichment (Deterministic + Light AI Optional)
Enrich candidates with:
- Site context (brand name, industry, geography)
- "Page role" if page context exists (home page vs product page)
- Recommended owners (marketing vs web vs engineering)
- **Industry-specific knowledge** (FAQs, certifications, schema) — see §13-16

### Stage C — Overlap Detection + Clustering (Deterministic)
Before writing copy, cluster candidates to avoid overlaps.

**Clustering rules**
- Same outcome, different pillars → cluster into one primary recommendation
  - Example: "Add Organization schema" (Schema Markup) + "Add About/Contact NAP consistency" (Trust) may merge into one "Make your company verifiable to AI" cluster.
- Within a cluster:
  - Choose one **primary pillar** (the most direct lever)
  - Convert others into "Also improves…" bullets (secondary benefits)

**Output**
- `cluster_id`
- `primary_rec` + `secondary_notes`

### Stage D — Copy Generation (Marketing-First) (AI-Assisted Allowed)
Generate `marketing_copy`, `technical_copy`, `exec_copy` using templates + optional LLM.

**Hard rule:** Copy must only claim what evidence supports.
- If you didn't detect it, don't assert it.
- Use language like "We didn't find…" / "It appears missing…" when evidence is incomplete.

**Industry enrichment:** If `org_profile.company_type` is set, pull from knowledge bases (§13-16) to:
- Suggest relevant FAQs
- Recommend industry-specific schema
- Highlight expected certifications

### Stage E — Ranking + Selection (Deterministic)
Compute final ordering using:
- Severity (score gap)
- Impact (expected gain)
- Effort
- Confidence
- Pillar diversity (avoid 10 in same pillar)

This ranking feeds:
- Progressive unlock selection (handled by spec 17)
- UI order and exports

---

## 5. Copy Quality Requirements

### 5.1 Marketing Copy Format (Default View)
**Structure**
- **Finding** (1 sentence, factual)
- **Why it matters** (1–2 sentences)
- **What to do** (3–5 bullets, non-technical)
- **Success check** (1 sentence: how user knows it's done)

**Tone rules**
- Outcome-first language ("Help AI assistants verify your company")
- Avoid jargon; if a term is unavoidable, define it
- No code snippets in default view

### 5.2 Technical Copy (Expand)
**Allowed**
- Implementation steps
- Tool references (e.g., validators)
- Minimal snippets only when necessary (kept short)

**Not allowed**
- Long code blocks
- Instructions that require risky changes without warnings

### 5.3 Exec Copy (Expand)
Must include:
- Business impact (pipeline, trust, discoverability)
- Risk if ignored
- Effort estimate + typical owner
- Timeline band (hours / days / weeks)

---

## 6. Evidence Requirements (No Hallucinations)

Each actionable recommendation must include **at least one** of:
- Rule failure with confidence ≥ threshold
- Selector checks (found/missing) with URL context
- Extracted text mismatch (e.g., language mismatch between key pages)
- Structured data parse result (schema present/absent/invalid)

**Minimum evidence payload**
```json
{
  "urls": ["https://example.com/"],
  "rule_ids": ["schema_org_missing"],
  "selectors_found_summary": "0/4 Organization schema selectors found"
}
```

If evidence is partial:
- Downgrade to `diagnostic`
- Or reduce confidence score and soften language ("we couldn't confirm…")

---

## 7. Language Mismatch Handling (Required)

### 7.1 Detection
Detect when:
- Primary page language differs across key pages (home, about, product)
- Meta/structured data language differs from visible content
- Mixed-language headings create extraction problems

### 7.2 Recommendation Behavior
- Create one **primary** recommendation:
  - "Make your site consistent for AI readers" (Content AI Can Use)
- Include a sub-bullet: "Also improves Speak AI's Language / Be Trusted" as secondary benefits
- Evidence must include:
  - URLs sampled
  - Detected language labels
  - Excerpted signals (short)

---

## 8. Overlap Rules (Required)

### 8.1 Dedup Keys
`dedup_key` must be stable:
- Based on outcome + entity type + page role (if applicable)
- **Not** based on scan_id

**Examples:**
- `schema.org:Organization:missing`
- `nav:about-contact:missing`
- `content:faq:missing`
- `trust:reviews:missing`
- `cert:hipaa:missing`
- `faq:industry:msp:missing`

### 8.2 One Recommendation Per Outcome
If multiple rules indicate the same underlying fix:
- Produce one recommendation
- List multiple rule IDs in evidence

### 8.3 Cross-Pillar Explanation
Recommendations may touch multiple pillars, but must:
- Have exactly one `pillar_key` owner
- Optionally list `secondary_pillars[]` in evidence/metadata
- UI can show "Also improves…"

---

## 9. "Never-Zero" Behavior (Contract)

If the detector finds **0** actionable issues:
- Generate **one diagnostic** recommendation:
  - "You're in good shape — here's how to maintain and extend it"
- Include a small set of "advanced" locked items (if plan supports) to demonstrate ongoing value
- Reference industry-specific advanced recommendations from knowledge bases

---

## 10. Plan-Aware Output (What's Generated vs What's Displayed)

### 10.1 Core rule
**Generate everything** (full recommendation pool), then apply plan rules at **delivery** (API response) and **display** (UI).

### 10.2 Required entitlement keys (single source of truth)
These keys must be available at runtime (from entitlements config) and used consistently across API + UI:

- `recommendationsProgressiveUnlockEnabled` (bool)
- `recommendationsCycleDays` (int)
- `recommendationsBatchSize` (int)
- `recommendationsActiveCap` (int)
- `recommendationsMaxReturn` (int | -1)

**Industry enrichment gating**
- `industryEnrichmentEnabled` (bool)
- `industryFaqSuggestionsEnabled` (bool)
- `industryCertSuggestionsEnabled` (bool)
- `industrySchemaSuggestionsEnabled` (bool)
- `industryEnrichmentDetailLevel` = `teaser` | `standard` | `full`

> Contract: Engine may generate enriched outputs, but API must redact/limit based on entitlements (see 10.3).

### 10.3 Delivery rules (what the API returns)
To avoid UI overload and prevent “fallback shows everything” bugs, the API must enforce:

- Active list is capped by `recommendationsActiveCap` (after progressive unlock selection).
- Locked items are returned as **counts + optional teasers**, not full bodies, unless plan allows.
- Enriched payload fields (`suggested_faqs`, `suggested_certifications`, `suggested_schema`) must be:
  - included only when enabled, and
  - redacted down to a safe teaser level when `industryEnrichmentDetailLevel='teaser'`.

**Enrichment redaction policy**
- `teaser`: return titles + counts only (no full FAQ answers; no schema markup body)
- `standard`: return FAQ questions + short answers, certification names, schema type + key properties (no full JSON-LD)
- `full`: return full `suggested_*` objects including templated markup payloads (never claim unverified certs; see §14.5)

### 10.4 Recommended plan defaults (can be adjusted later)
| Plan | Progressive Unlock | Enrichment Enabled | Detail Level |
|------|---------------------|-------------------|--------------|
| Free | ✅ (strict) | ✅ (limited) | `teaser` |
| DIY | ✅ (5 per 5 days) | ✅ | `standard` |
| Pro | ✅ (more generous) | ✅ | `full` |
| Agency/Ent | Configurable | ✅ | `full` |

**Important**
- Do not filter to zero based on plan.
- If all actionable items are locked, show at least one diagnostic + teasers.
- Never allow the UI to “guess” entitlements; it must render what the API returns.

---

## 11. Safety + Correctness Guardrails

### 11.1 Claim Guard
Any sentence that asserts a fact about the site must be supported by evidence.

### 11.2 Validation Guard
If recommending a risky change:
- Include a warning and "validate after change" step in technical copy

### 11.3 Output Schema Validation
Before saving:
- Validate required fields present
- Validate `unlock_state` defaults to `locked`
- Validate `marketing_copy` is non-empty
- Validate evidence minimum payload

---

## 12. Observability Requirements (For the Engine)

Log and/or emit events:
- `recommendation_generated`
- `recommendation_clustered`
- `recommendation_saved`
- `recommendation_generation_failed` (with error code)

Include:
- `request_id`
- `scan_id`, `domain_id`, `organization_id`
- Counts by pillar
- Counts by type (actionable/diagnostic)
- Top clusters
- Engine version
- Industry enrichment applied (yes/no, which knowledge bases)

Failures must never be silent:
- If generation fails, produce a diagnostic fallback and record the failure.

---

## 13. Industry-Specific FAQ Libraries

### 13.1 Overview

Visible2AI maintains industry-specific FAQ libraries that inform recommendations. These libraries help generate high-value FAQ recommendations tailored to what buyers in each industry actually ask.

### 13.2 Supported Industries

| Industry (`company_type`) | FAQ Topics | Example Questions |
|---------------------------|------------|-------------------|
| `ucaas` | CPaaS, VoIP, roaming, SIP, unified communications | "What's the difference between UCaaS and CCaaS?" |
| `msp` | MDR, M365, SOC, RMM, managed services | "What security certifications should my MSP have?" |
| `telecom` | 5G, fiber, carrier services, SD-WAN | "How does SD-WAN improve network reliability?" |
| `fintech` | PCI-DSS, SOC2, payments, compliance | "Is your payment processing PCI compliant?" |
| `cybersecurity` | Zero trust, SIEM, EDR, XDR, compliance | "What's the difference between EDR and XDR?" |
| `saas_b2b` | Integration, API, uptime, SLA | "What's your SLA for enterprise customers?" |
| `healthcare` | HIPAA, PHI, telehealth, patient privacy | "How do you protect patient health information?" |
| `legal` | Confidentiality, e-discovery, privilege | "How do you handle attorney-client privilege?" |
| `marketing_agency` | ROI, reporting, AI strategy, channels | "How do you measure campaign ROI?" |
| `ict_hardware` | Warranty, support, compatibility | "What's included in your hardware warranty?" |
| `financial_services` | Compliance, fiduciary, risk management | "Are you a registered fiduciary?" |
| `real_estate` | Licensing, markets, transaction process | "What areas do you serve?" |
| `education` | Accreditation, outcomes, support | "What is your student success rate?" |
| `manufacturing` | Quality, certifications, capacity | "What quality certifications do you hold?" |

### 13.3 Two-Tier Answer Structure

Each FAQ has two answer versions to serve different purposes:

| Tier | Purpose | Used For |
|------|---------|----------|
| **Marketing tier** | Human-friendly, strategic, benefit-focused | `marketing_copy`, website display, user-facing FAQs |
| **Technical tier** | Factual anchors, specifications, structured data | Schema markup, AI training signals, `technical_copy` |

**Example:**
```json
{
  "question": "What security certifications do you have?",
  "industry": "msp",
  "answers": {
    "marketing": "We maintain SOC 2 Type II and ISO 27001 certifications, with annual third-party audits to ensure your data stays protected.",
    "technical": "Certifications: SOC 2 Type II (annual audit, Schellman & Co.), ISO 27001:2022 (BSI certified), PCI-DSS Level 1 Service Provider. Audit reports available under NDA. Last audit: 2025-09."
  },
  "schema_hint": {
    "type": "FAQPage",
    "properties": ["mainEntity", "acceptedAnswer"]
  }
}
```

### 13.4 FAQ Recommendation Generation

When generating FAQ-related recommendations:

```
1. Lookup org_profile.company_type
2. If company_type exists, load industry FAQ library
3. Detect which FAQ topics are missing from site:
   - Check for FAQPage schema
   - Check for FAQ content sections
   - Check for question-answer patterns
4. Generate recommendation with:
   - Suggested questions from library (top 5-10 most relevant)
   - Marketing-tier answers as examples
   - Technical-tier answers for schema markup
   - FAQPage schema template
```

**Recommendation output:**
```json
{
  "dedup_key": "faq:industry:msp:missing",
  "pillar_key": "content_structure",
  "title": "Add Industry-Specific FAQs",
  "priority": "p1",
  "impact": "high",
  "effort": "medium",
  "marketing_copy": "AI assistants often recommend MSPs that clearly answer common buyer questions. Your site is missing FAQs about MDR, SOC services, and M365 management that your competitors likely have.",
  "evidence": {
    "industry": "msp",
    "missing_faq_topics": ["mdr", "soc_services", "m365_management", "security_certifications"],
    "faq_schema_detected": false,
    "faq_content_detected": false
  },
  "suggested_faqs": [
    {
      "question": "What's included in your MDR service?",
      "answer_marketing": "Our MDR service provides 24/7 threat monitoring, incident response, and proactive threat hunting—all managed by our certified security analysts.",
      "answer_technical": "MDR scope: 24/7 SOC monitoring, SIEM integration (Splunk, Sentinel, or customer SIEM), 15-minute SLA for critical alerts, quarterly threat reports, incident response retainer included."
    },
    {
      "question": "What security certifications does your company hold?",
      "answer_marketing": "We maintain SOC 2 Type II and ISO 27001 certifications to ensure enterprise-grade security for all our clients.",
      "answer_technical": "Certifications: SOC 2 Type II, ISO 27001:2022. Compliance frameworks supported: NIST CSF, CIS Controls, HIPAA (BAA available)."
    }
  ]
}
```

### 13.5 FAQ Library File Structure

```
/knowledge-bases/faqs/
├── ucaas/
│   ├── questions.json       # Industry-specific FAQ questions
│   ├── answers-marketing.md # Human-friendly answers
│   └── answers-technical.md # Factual anchors for AI
├── msp/
│   ├── questions.json
│   ├── answers-marketing.md
│   └── answers-technical.md
├── healthcare/
│   └── ...
├── fintech/
│   └── ...
└── _generic/
    ├── questions.json       # Fallback for unknown industries
    └── answers.md
```

---

## 14. Industry-Specific Certifications

### 14.1 Overview

Different industries have different certification expectations. Recommendations should highlight missing certifications that buyers in that industry expect to see.

### 14.2 Certification Matrix

| Industry | Required/Expected | Recommended | Nice-to-Have |
|----------|-------------------|-------------|--------------|
| `fintech` | PCI-DSS | SOC 2 Type II, ISO 27001 | SOC 1, GDPR attestation |
| `healthcare` | HIPAA | HITRUST, SOC 2 | ISO 27001 |
| `msp` | SOC 2 Type II | ISO 27001, CMMC | SOC 1, PCI-DSS |
| `cybersecurity` | SOC 2 Type II | ISO 27001, FedRAMP | CMMC, StateRAMP |
| `legal` | — | ISO 27001, SOC 2 | GDPR attestation |
| `government` | FedRAMP, CMMC | StateRAMP | ISO 27001 |
| `saas_b2b` | SOC 2 Type II | ISO 27001 | GDPR, CCPA attestation |
| `education` | FERPA | SOC 2 | ISO 27001 |

### 14.3 Certification Detection

**Policy note:** Absence of evidence is not evidence of absence. Detection drives recommendations, but copy must use *soft language* when a certification is not confirmed (see §14.5).


Detection engine checks for:
- Certification mentions in page content (footer, about, trust page)
- Trust badges/logos (with alt text analysis)
- Schema markup with `hasCredential` property
- Dedicated security/trust/compliance pages
- PDF links to certification documents

### 14.4 Certification Recommendation Generation

When generating certification-related recommendations:

```
1. Lookup org_profile.company_type
2. Load certification matrix for industry
3. Detect which certifications are:
   a. Mentioned but not structured (in text only)
   b. Completely missing
   c. Properly structured (hasCredential schema)
4. Generate recommendation based on gap:
   - Missing entirely → "Add certification information"
   - Mentioned but not structured → "Structure your certifications for AI"
```

**Recommendation output:**
```json
{
  "dedup_key": "cert:hipaa:missing",
  "pillar_key": "trust_authority",
  "title": "Highlight Your Healthcare Compliance",
  "priority": "p0",
  "impact": "high",
  "effort": "low",
  "marketing_copy": "Healthcare buyers expect HIPAA compliance. While you mention it briefly, AI assistants can't easily extract this. Add structured certification data so AI can confidently recommend you to healthcare organizations.",
  "evidence": {
    "industry": "healthcare",
    "expected_certs": ["HIPAA"],
    "recommended_certs": ["HITRUST", "SOC 2"],
    "detected_certs_structured": [],
    "detected_certs_text_only": ["HIPAA mention in privacy policy"],
    "detection_locations": [
      {"url": "/privacy", "context": "paragraph 3", "cert": "HIPAA"}
    ]
  },
  "suggested_certifications": [
    {
      "name": "HIPAA",
      "importance": "required",
      "schema_property": "hasCredential",
      "display_recommendation": "Add to footer, about page, and trust page"
    },
    {
      "name": "HITRUST",
      "importance": "recommended",
      "schema_property": "hasCredential",
      "display_recommendation": "If certified, prominently display badge"
    }
  ],
  "what_to_do": [
    "Create a dedicated Trust or Security page",
    "Add hasCredential schema for each certification",
    "Include certification logos with descriptive alt text",
    "Link to certification verification where available"
  ]
}
```

---


### 14.5 Safety + Verification Policy (No False Claims)

Certifications and compliance statements are high-stakes. The engine must avoid asserting claims it cannot verify.

**Hard rules**
- Never state or imply: “You are certified” unless evidence supports it (badge + text + verification link or clear documented statement).
- If certification is **not found**, do **not** say “You are not certified.” Use softer, accurate language:
  - “We didn’t find evidence of X on your site. If you have it, highlight it; if not, consider pursuing it.”
- If evidence is partial (e.g., a badge image with no explanation), generate an **actionable recommendation** to clarify and link to verification; reduce `confidence_score`.

**Output behavior**
- If certified evidence exists → recommend **“Highlight your certification posture”** (Trust & Authority) and optionally add `hasCredential` schema as secondary.
- If evidence does not exist → recommend **“Add/clarify your compliance posture”** (Trust & Authority) with:
  - a checklist of what to publish (policy, badge, attestation summary, contact, verification link where available)
  - no legal/guarantee language

**Evidence requirements**
Each certification recommendation must include:
- `evidence.urls[]` where checked (e.g., /security, /trust, /about, footer)
- `evidence.selectors_found_summary`
- `evidence.cert_signals[]` with exact strings/badge alt text found (if any)

---
## 15. Customized Schema Recommendations

### 15.1 Overview

Different industries benefit from different schema types. Recommendations should suggest the most impactful schema based on `company_type`.

### 15.2 Schema by Industry Matrix

| Industry | Primary Schema | Secondary Schema | Key Properties |
|----------|---------------|------------------|----------------|
| `ucaas` | `SoftwareApplication` | `Organization`, `FAQPage` | `applicationCategory`, `operatingSystem`, `offers` |
| `msp` | `ProfessionalService` | `Organization`, `FAQPage` | `areaServed`, `hasCredential`, `serviceType` |
| `fintech` | `FinancialService` | `Organization` | `hasCredential`, `feesAndCommissionsSpecification` |
| `healthcare` | `MedicalBusiness` | `Physician`, `FAQPage` | `medicalSpecialty`, `isAcceptingNewPatients`, `hasCredential` |
| `legal` | `LegalService` | `Attorney`, `FAQPage` | `areaServed`, `knowsAbout`, `hasCredential` |
| `ecommerce` | `Product`, `Offer` | `Organization`, `BreadcrumbList` | `price`, `availability`, `review`, `aggregateRating` |
| `saas_b2b` | `SoftwareApplication` | `Organization`, `FAQPage` | `applicationCategory`, `operatingSystem`, `offers`, `aggregateRating` |
| `marketing_agency` | `ProfessionalService` | `Organization`, `FAQPage` | `areaServed`, `serviceType`, `knowsAbout` |
| `real_estate` | `RealEstateAgent` | `Organization`, `FAQPage` | `areaServed`, `knowsAbout` |
| `manufacturing` | `Organization` | `Product`, `FAQPage` | `hasCredential`, `areaServed`, `brand` |

### 15.3 Schema Recommendation Enrichment (Template-Based)

When generating schema recommendations, Visible2AI must use **knowledge-base templates** (not freeform generation) and interpolate only from fields we actually collect (onboarding/org profile).

**Hard rules**
- Do not generate arbitrary JSON-LD “from scratch.”
- Always reference a template ID from the KB and populate placeholders.
- If required org fields are missing, downgrade to `diagnostic` or return a “complete your profile” prerequisite.

**Template selection**
1. Resolve `industry = org_profile.company_type` (normalized; see §16.5)
2. Load schema template set: `KB.schemas[industry]` else `KB.schemas['_generic']`
3. Select `primary_template_id` + optional `secondary_template_ids` based on:
   - page role (site-first; page optional)
   - score gaps (Schema Markup + Content Structure + Trust)
   - highest expected gain (P0 first)

**Output shape (recommended)**
`suggested_schema` should include:
- `primary_type` (e.g., `SoftwareApplication`, `ProfessionalService`)
- `template_id` (e.g., `schemas/msp/professional_service.v1.jsonld`)
- `required_profile_fields[]`
- `key_properties[]`
- `example_markup_template` (templated JSON-LD with placeholders) **only if plan allows**
- `fill_map` (which placeholders were filled vs missing)

```javascript
function enrichSchemaRecommendation(rec, orgProfile, kb, entitlements) {
  const industry = normalizeCompanyType(orgProfile.company_type, kb.companyTypeMap);
  const templates = kb.schemas[industry] || kb.schemas['_generic'];

  const selected = selectSchemaTemplates({ templates, orgProfile });
  rec.suggested_schema = {
    primary_type: selected.primary.type,
    template_id: selected.primary.template_id,
    key_properties: selected.primary.key_properties,
    required_profile_fields: selected.primary.required_profile_fields,
    fill_map: computeFillMap(selected.primary, orgProfile)
  };

  // Only return full templated markup when plan allows
  if (entitlements.industrySchemaSuggestionsEnabled && entitlements.industryEnrichmentDetailLevel === 'full') {
    rec.suggested_schema.example_markup_template = selected.primary.template_jsonld; // contains placeholders like {{company_name}}
  }

  return rec;
}
```

**Validation steps (technical copy)**
- Validate schema via a validator tool.
- Confirm the markup appears on the correct canonical pages.
- Re-scan to verify score lift.

### 15.4 Example Output

For a healthcare company missing schema:

```json
{
  "dedup_key": "schema:MedicalBusiness:missing",
  "pillar_key": "schema_markup",
  "title": "Add Healthcare-Specific Schema",
  "priority": "p0",
  "impact": "high",
  "effort": "medium",
  "marketing_copy": "Healthcare-focused AI assistants look for MedicalBusiness schema to recommend providers. Your site has basic Organization markup but is missing the healthcare-specific signals that help AI understand your specialty, credentials, and availability.",
  "technical_copy": "Implement MedicalBusiness schema (extends LocalBusiness) with the following properties: @type, name, medicalSpecialty, hasCredential (for HIPAA/certifications), isAcceptingNewPatients, availableService, and areaServed. Validate with Google Rich Results Test and Schema.org validator.",
  "evidence": {
    "industry": "healthcare",
    "current_schema": ["Organization"],
    "missing_schema": ["MedicalBusiness", "Physician"],
    "missing_properties": ["medicalSpecialty", "hasCredential", "isAcceptingNewPatients"]
  },
  "suggested_schema": {
    "primary": "MedicalBusiness",
    "secondary": ["Physician", "FAQPage"],
    "key_properties": [
      {"name": "medicalSpecialty", "importance": "high", "example": "Cardiology"},
      {"name": "hasCredential", "importance": "high", "example": "HIPAA Compliance"},
      {"name": "isAcceptingNewPatients", "importance": "medium", "example": true}
    ],
    "example_markup": {
      "@context": "https://schema.org",
      "@type": "MedicalBusiness",
      "name": "{{company_name}}",
      "medicalSpecialty": "{{specialty}}",
      "hasCredential": {
        "@type": "EducationalOccupationalCredential",
        "credentialCategory": "Certification",
        "name": "HIPAA Compliance"
      },
      "isAcceptingNewPatients": true
    }
  }
}
```

### 15.5 Schema Priority by Industry

Some industries have "table stakes" schema that should be prioritized:

| Industry | Table Stakes (P0) | High Value (P1) | Nice-to-Have (P2) |
|----------|-------------------|-----------------|-------------------|
| `healthcare` | MedicalBusiness | FAQPage, Physician | Review, HowTo |
| `legal` | LegalService | FAQPage, Attorney | Review |
| `saas_b2b` | SoftwareApplication | FAQPage, Organization | Review, HowTo |
| `ecommerce` | Product, Offer | BreadcrumbList, FAQPage | Review, HowTo |
| All | Organization | FAQPage | Review, HowTo, Article |

---


### 15.6 Schema Template Library (Knowledge Base)

Schema templates live in the knowledge base to ensure:
- consistency across recommendations
- controlled updates + versioning
- minimal hallucination risk

**Storage structure (example)**
- `knowledge/schemas/_generic/organization.v1.jsonld`
- `knowledge/schemas/msp/professional_service.v1.jsonld`
- `knowledge/schemas/ucaas/software_application.v1.jsonld`
- `knowledge/schemas/fintech/financial_service.v1.jsonld`

**Template rules**
- Templates may include placeholders (e.g., `{{company_name}}`, `{{logo_url}}`, `{{same_as}}`).
- Placeholders must map to fields in `org_profile` / `domain_profile`.
- If a placeholder cannot be filled, engine must:
  - mark it missing in `fill_map`, and
  - recommend completing profile or publishing the missing data on-site.

**Never output**
- claims about certifications (see §14.5)
- properties not supported by the selected schema type

---
## 16. Knowledge Base Maintenance

### 16.1 Update Cadence

| Asset | Update Frequency | Owner | Trigger |
|-------|------------------|-------|---------|
| FAQ libraries | Quarterly | Product | Industry trends, customer feedback |
| Certification matrix | Bi-annually | Compliance | Regulatory changes |
| Schema mappings | With schema.org updates | Engineering | Schema.org releases |
| Industry benefits copy | Quarterly | Marketing | Messaging updates |

### 16.2 Knowledge Base Storage Structure

```
/knowledge-bases/
├── faqs/
│   ├── {industry}/
│   │   ├── questions.json        # Question list with metadata
│   │   ├── answers-marketing.json # Marketing-tier answers
│   │   └── answers-technical.json # Technical-tier answers
│   └── _generic/
│       └── questions.json
├── certifications/
│   ├── by-industry.json          # Certification matrix
│   └── schema-templates.json     # hasCredential templates
├── schemas/
│   ├── by-industry.json          # Schema type mappings
│   └── property-templates/       # Per-type property templates
│       ├── MedicalBusiness.json
│       ├── LegalService.json
│       └── ...
└── copy/
    ├── industry-benefits.json    # Industry-specific benefit copy
    └── pillar-headlines.json     # Marketing headlines by pillar
```

### 16.3 Knowledge Base Versioning

Each knowledge base file includes version metadata:

```json
{
  "_meta": {
    "version": "2026.Q1",
    "last_updated": "2026-01-11",
    "updated_by": "product_team",
    "change_summary": "Added telehealth FAQs for healthcare vertical"
  },
  "questions": [...]
}
```

### 16.4 Fallback Behavior

If `company_type` is unknown or not in knowledge base:
1. Use `_generic` FAQ library
2. Use `Organization` as primary schema
3. Skip certification recommendations (or use generic "Add trust signals")
4. Log `knowledge_base_fallback` event for analytics

---


### 16.5 Company Type Taxonomy + Synonym Mapping

Industry enrichment depends on `org_profile.company_type`. To prevent silent fallbacks, Visible2AI must maintain a **canonical taxonomy** and a **synonym map**.

#### Canonical taxonomy (minimum set)
- `_generic` (fallback)
- `msp`
- `ucaas`
- `telecom`
- `fintech`
- `cybersecurity`
- `saas_b2b`
- `healthcare`
- `legal`
- `government`
- `ecommerce`

> Add new industries by extending the KB (do not hardcode in engine logic).

#### Normalization rules
When `company_type` is collected or inferred:
1. lower-case, trim, remove punctuation
2. match exact canonical values
3. else match synonyms map (contains many-to-one mappings)
4. else return `_generic` and emit `knowledge_base_fallback`

#### Synonym map storage (KB)
- `knowledge/company_type_map.json`

Example entries:
```json
{
  "managed services provider": "msp",
  "it managed services": "msp",
  "unified communications": "ucaas",
  "voip": "ucaas",
  "carrier": "telecom",
  "payments": "fintech",
  "infosec": "cybersecurity",
  "b2b saas": "saas_b2b",
  "online store": "ecommerce"
}
```

#### Onboarding requirement
Prefer a dropdown (canonical list) plus optional “Other” text field that is mapped into the taxonomy.

---
## 17. Test Checklist

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 1 | Low pillar score + missing evidence | Diagnostic recommendation, not actionable |
| 2 | Multiple rules for same fix | One recommendation with multiple rule_ids |
| 3 | Mixed-language pages | Language mismatch rec created with evidence |
| 4 | All issues resolved | "Maintenance" diagnostic returned |
| 5 | Marketing copy contains no jargon/code | Pass quality check |
| 6 | Technical copy includes clear validation step | Present and actionable |
| 7 | Dedup_key stable across rescans | No pool inflation |
| 8 | Clustering prevents "same rec repeated across pillars" | One primary + secondary bullets |
| 9 | Healthcare company missing MedicalBusiness schema | Industry-specific schema recommendation generated |
| 10 | MSP missing FAQ section | Industry-specific FAQ recommendation with MDR, SOC topics |
| 11 | Fintech company missing PCI-DSS mention | Certification recommendation with "required" flag |
| 12 | Unknown industry (`company_type` = null) | Falls back to generic recommendations |
| 13 | FAQ library has two-tier answers | Both marketing and technical tiers present in output |
| 14 | Schema recommendation includes example markup | Valid JSON-LD template in `suggested_schema` |
| 15 | Certification mentioned but not structured | "Structure your certifications" rec, not "Add certifications" |

---

## 18. Migration Path

### Phase 1 Tasks (Database)

1. **Add columns** to `scan_recommendations`:
   ```sql
   ALTER TABLE scan_recommendations
     ADD COLUMN IF NOT EXISTS suggested_faqs JSONB,
     ADD COLUMN IF NOT EXISTS suggested_schema JSONB,
     ADD COLUMN IF NOT EXISTS suggested_certifications JSONB,
     ADD COLUMN IF NOT EXISTS industry_enrichment_applied BOOLEAN DEFAULT FALSE;
   ```

2. **Add columns** to `org_profiles` (if not present):
   ```sql
   ALTER TABLE org_profiles
     ADD COLUMN IF NOT EXISTS company_type TEXT;
   ```

### Phase 4 Tasks (Generation Engine)

1. **Build knowledge base loader** for FAQs, certifications, schemas
2. **Implement industry enrichment** in Stage B of generation pipeline
3. **Add FAQ recommendation generator** that pulls from library
4. **Add schema recommendation enricher** based on industry
5. **Add certification gap detector** and recommendation generator
6. **Update API** to include `suggested_*` fields in response

---

## 19. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-11 | Initial draft with core generation pipeline |
| 1.1 | 2026-01-11 | Added §13-16: Industry-specific FAQ libraries, certifications, customized schema recommendations, knowledge base maintenance |
