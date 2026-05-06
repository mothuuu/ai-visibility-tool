# Citation Monitoring — Product Decisions

**Status:** Decisions locked. Reference for build work.
**Last updated:** May 2, 2026
**Decided by:** Monali

---

## Scope

This document captures the product-level decisions for the Citation Monitoring + Prompt Volume feature (Phase 3 of the SSOT). These are not technical implementation choices — those are the new hire's call, in consultation with Arhan. These are the decisions only the founder makes.

If you are the new hire reading this: build to these decisions. If anything here looks wrong or unclear, raise it before you build it, not after.

---

## 1. Mention detection: LLM-based

The detection layer is LLM-based, not exact-match or fuzzy. Each engine response is evaluated by a separate LLM call that returns whether the brand was mentioned, recommended, or cited — along with the snippet of where it appeared.

**Detection model:** Claude Haiku (latest available version on Anthropic SDK).

**Why Haiku, not Sonnet/Opus or GPT-4o-mini:**
- Anthropic SDK is already in the codebase. No new provider, no new key, no new rate limit to manage.
- Detection is a structured judgment task. Small fast models do this well.
- Cost and latency stay low enough to keep unit economics workable.

**Architectural implication:** The engine adapter and the mention detector are separate concerns. Engine adapters take a prompt, call the engine (ChatGPT / Claude / Perplexity), return raw response. The `MentionDetector` service takes the raw response plus brand context, calls Haiku, returns structured detection results. Detection logic does not live inside the adapters.

This separation is non-negotiable. It is what allows us to swap detection models later (cheaper / better / different per tier) without rewriting the engine layer.

---

## 2. Activation: manual, token-gated

Citation tests do not run automatically with scans. They are a separate, gated user action.

- User explicitly clicks "Run citation test" (or equivalent) from the UI.
- Tokens are deducted at the point of activation.
- No cron-scheduled monitoring in MVP. (Scheduled testing is a possible v2 feature; not in scope now.)

**Why manual, not auto:**
- Costs are bounded by user intent. No surprise bills.
- Users value what they actively spend on.
- Keeps the data model simple — no scheduling tables, no tier-based monitoring frequencies.

---

## 3. Plan-agnostic, token-based pricing

Citation testing is not a plan benefit. It is a token-spending action available to any user who has tokens, regardless of plan tier (Free, Starter, Pro).

- Free users can run citation tests if they buy tokens.
- Plan tier determines other things (scan limits, findings depth, etc.) but not citation test access.
- This is consistent with the Phase 2 token-based pivot: tokens become the unit of paid action across multiple features.

**Token cost per test:** equivalent to **$2.00 of customer-facing value**, expressed in tokens. Convert using the established token-to-dollar ratio in the existing pack pricing. If that ratio is unclear, raise with Monali before building.

A "test" = one execution of the configured prompt cluster (3 prompts × 3 engines = 9 queries + 9 detections). If the prompt cluster size changes in the future, the token cost scales with it.

**Detection model cost is bundled into the test cost.** The user does not pay separately for detection.

---

## 4. What the customer sees on a result

Each citation test result shows, per engine per prompt:

- **Mentioned** (boolean) — did the brand appear in the response at all?
- **Recommended** (boolean) — was the brand presented as a recommendation, not a passing reference?
- **Cited** (boolean) — was the brand cited as a source, with link or attribution?
- **Snippet** — the relevant ~50–100 word excerpt from the response showing where the brand appeared (or context where it was absent and competitors were named).

The customer does NOT see:
- The detector LLM's reasoning. (Stored in the database for QA and debugging, not shown.)
- The full response text from the engine. (Stored, not shown by default. Could be a "show full response" expand in v2.)

**Why show snippets but not reasoning:**
- Snippets are the proof. They are what makes the feature credible and actionable.
- Reasoning is internal — useful for tuning the detector, not useful for the customer's decision-making.
- Showing reasoning makes the UI dense and the product feel academic. Snippets feel like evidence.

---

## 5. Engines in MVP

- **ChatGPT** (OpenAI API)
- **Claude** (Anthropic API)
- **Perplexity** (Perplexity API)

**Not in MVP:**
- Gemini / Google AI Overviews (deferred — separate work)
- Any other engines

Confirm Perplexity API access exists before the new hire is deep in the build. If access is gated or unavailable, raise immediately — Perplexity is on the critical path for this feature.

---

## 6. Storage and retention

The `citation_evidence` table (already migrated) stores per-engine, per-prompt results including raw response and detection output. Retention policy: indefinite for MVP. Revisit if storage costs become non-trivial.

The detector's reasoning text must be stored even though it is not surfaced to the user — it is required for QA when detection accuracy is questioned, and for tuning the detection prompt over time.

---

## Open questions still pending

These are not yet decided and need resolution before deep build:

- **Token-to-dollar ratio.** What does $2.00 of customer-facing value translate to in tokens, given the existing pack pricing? Monali to confirm with the current Stripe pricing config.
- **Prompt cluster source.** Where do the 3 prompts per test come from for a given customer? Pre-seeded by industry vertical? Generated from their site? Manually entered? This is the next product decision after token cost is set.
- **Frontend surface.** No frontend exists today. Wireframe or design direction needed before the new hire builds the UI. Lower priority than backend work.

---

## Out of scope (do not build in MVP)

- Scheduled / recurring citation tests
- Vertical benchmarking (anonymized aggregation across customers)
- Citation alerts / notifications
- Gemini / Google AI Overviews
- Competitor citation maps as a standalone view
- Historical trend dashboards

These are real future features. They are explicitly deferred to keep MVP scope tight.

---

## Naming reminder

This feature is **Citation Monitoring**. It is not the **AI Citation Network** (the directory submission product, ListingBot-style). The two products share the word "citation" but are entirely separate. Do not modify, reuse, or reference AI Citation Network code, tables, or cron jobs while building Citation Monitoring. The cron job called "citation network reminders" belongs to the directory submission product. Leave it alone.
