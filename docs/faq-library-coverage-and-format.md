# FAQ Library — Coverage Table & Format Spec

Deliverable from Phase 3 (Build 2). Two purposes: (1) record why Build 2 ships a
**pooled** FAQ Pack rather than three per-stage blocks, and (2) give the
library-expansion workstream a precise target format.

## Why pooled, not per-stage (coverage reality)

Each of the 14 industry libraries
(`backend/phase2_preserved/recommendation-engine/faq-libraries/*.json`) contains
**exactly 5 FAQs total** — not 5 per stage. `buyer_stage`
(`implementation_notes.buyer_stage`) is a freeform phrase; the generator maps it
to a funnel bucket generously: contains "awareness" → TOFU, contains "decision"
→ BOFU, else MOFU.

Bucketed per library (generator mapping):

| Industry | total | TOFU | MOFU | BOFU | safe-answerable | pooled deliverable |
|---|---|---|---|---|---|---|
| AI Infrastructure | 5 | 2 | 1 | 2 | 5 | 5 |
| AI Startups | 5 | 1 | 0 | 4 | 5 | 5 |
| Cybersecurity | 5 | 0 | 2 | 3 | 5 | 5 |
| Data Center | 5 | 0 | 4 | 1 | 5 | 5 |
| Digital Infrastructure | 5 | 0 | 3 | 2 | 5 | 5 |
| Fintech | 5 | 2 | 1 | 2 | 5 | 5 |
| ICT Hardware | 5 | 0 | 1 | 4 | 5 | 5 |
| Managed Service Providers | 5 | 1 | 3 | 1 | 4 | 4 |
| Marketing Agencies | 5 | 1 | 0 | 4 | 5 | 5 |
| Mobile Connectivity/eSIM | 5 | 2 | 1 | 2 | 5 | 5 |
| SaaS B2B | 5 | 0 | 1 | 4 | 5 | 5 |
| Telecom Service Providers | 5 | 1 | 2 | 2 | 5 | 5 |
| Telecom Software | 5 | 1 | 2 | 2 | 5 | 5 |
| Cloud Communications/UCaaS | 5 | 0 | 3 | 2 | 5 | 5 |

Totals across 70 FAQs: **TOFU 11, MOFU 24, BOFU 35.**

**Consequence:** a 5-per-stage, 3-block unit is impossible — no library reaches 5
in any stage, and TOFU cannot even hit a min-3 floor for any single library.
A **pooled** block (up to 5 from the whole library, min 3) is deliverable for
**all 14** industries. Per-stage blocks become viable only after libraries are
expanded to genuine per-stage sets (target below); at that point they are added
config entries (`faq_tofu`/`faq_mofu`/`faq_bofu`) + a gate tweak — the generator
already accepts a `stage` filter and tags each FAQ with its bucket.

## Per-entry format (target for library expansion)

The AI-Infrastructure library is the verified reference. Fields the generator
consumes (others are ignored, safely):

```jsonc
{
  "question": "How do I prove my AI infrastructure handles production at scale?", // published verbatim (cleaned)
  "answer_template": "We serve {{segment}} teams with {{capability}}.",           // used ONLY if EVERY placeholder resolves
  "answer_fallback": "We help teams run reliable infrastructure at scale.",       // generic-true; used when extraction is incomplete
  "extraction_rules": {
    "segment":   { "method": "keyword_scan",     "keywords": ["fintech","healthcare"], "confidence_threshold": 0.7, "fallback": "various" },
    "capability":{ "method": "pattern_scan",     "patterns": ["(\\d+)% uptime"], "validation": "must be between 1-100", "fallback": "high uptime" },
    "name":      { "method": "entity_extraction","look_for": ["..."], "context": "about page", "confidence_threshold": 0.8, "fallback": "..." }
  },
  "implementation_notes": { "buyer_stage": "consideration to decision" },          // freeform funnel phrase
  "priority": "critical",        // ranking hint (critical|high|…)
  "found_on_percent": 92         // ranking hint (prevalence)
}
```

Rules the generator enforces (the anti-hallucination contract):

- **Answers are library-anchored.** `answer_human_friendly` / `answer_factual_backend`
  prose is **never** emitted — it is Xeo Marketing copy and would be published
  under the client's name. Only `answer_template` (fully resolved from client
  evidence) or `answer_fallback` is used.
- **All-or-nothing template resolution.** A `{{placeholder}}` is filled only from
  a successful extraction against the scan's stored evidence via its rule; if
  ANY placeholder fails, the whole answer falls back to `answer_fallback`
  (avoids half-templated claims like "majority%").
- **Skip if unsafe:** no `answer_fallback` and extraction incomplete → the entry
  is skipped. Any residual `{{…}}` or `Xeo`/`Visible2AI` mention → skipped.
- **Questions from the library only.** Extracted evidence feeds placeholder
  values, never new questions (never promote extracted page headings into FAQs).
- **< 3 safe entries for the block → the generator throws → the unlock rolls
  back (not charged).**

### Expansion target
To enable per-stage blocks: grow each industry library to **≥ 5 entries whose
`buyer_stage` buckets to each of TOFU / MOFU / BOFU** (≥15/library), each with an
`answer_template` + `extraction_rules` + a generic-true `answer_fallback`, and
each answer written in the **client's** voice (no Xeo/agency references) so that
even the fallback is publishable under the client's name.
