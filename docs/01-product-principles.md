# Visible2AI - Product Principles
## Foundational Decisions (Locked)

**Version:** 2.2  
**Status:** LOCKED  
**Date:** 2026-01-03

These principles guide ALL implementation decisions. Any deviation requires explicit approval and version update.

---

## Core Principles

### 1. Site-First, Page Optional

**Principle:** Default scan scope is site-level ("Website Visibility"). Page-level optimization is a gated future feature, fully architected now.

**Why:** 
- Simpler mental model for users in MVP
- Reduces complexity for initial launch
- Page-level can be activated without rebuilding

**Implementation:**
- `scans.scope` defaults to `'site'`
- `scan_pages` table exists (empty until feature activated)
- Page-level gated by `pageOptimization.enabled` entitlement
- UI shows "Website Visibility Score" as primary

**Future-Safe Architecture:**
```
MVP (Now):                      Future (No Rebuild):
┌─────────────┐                 ┌─────────────┐
│   Scan      │ scope='site'   │   Scan      │ scope='page'
│   ↓         │                │   ↓         │
│  Site-level │                │  Per-Page   │ → scan_pages populated
│   Score     │                │   Scores    │ → per-page recommendations
└─────────────┘                └─────────────┘
```

**Schema (already exists, empty until activated):**
- `scans.scope` column: `'site'` (default) or `'page'`
- `scan_pages` table: stores per-page results when scope='page'
- Entitlement: `pageOptimization.enabled` gates the feature (see `10-entitlements.v1.json`)

**What this means:**
- ✅ Scan a URL → get site-level recommendations
- ✅ Recommendations apply to "your website" not "this page"
- ✅ Database and API already support page-level (just not activated)
- ✅ When Pro/Enterprise launches, add logic without touching foundation
- ❌ Don't show "Page X has issue Y" in MVP
- ❌ Don't require page selection for basic scans

---

### 2. Score Scale: 0-1000 Everywhere

**Principle:** All scores use 0-1000 scale. No exceptions. No 0-100. No 0-125.

**Why:**
- Consistency prevents bugs
- Single mental model for users and developers
- Easy to aggregate (average of 0-1000 values = 0-1000)

**Implementation:**
- `scan_results.total_score` INTEGER CHECK (0-1000)
- All pillar scores: 0-1000
- All subfactor scores: 0-1000
- Display can show "850/1000" or "85%" but storage is always 0-1000

**What this means:**
- ✅ Database stores 850, not 85 or 8.5
- ✅ API returns 850, not 85
- ✅ Thresholds defined as 600, not 60
- ❌ Never store percentages
- ❌ Never mix scales

---

### 3. No Silent Failures

**Principle:** Every failure surfaces to user or logs. Nothing is swallowed.

**Why:**
- Silent failures cause "0 recommendations" mystery
- Debugging is impossible without visibility
- Users deserve to know when something went wrong

**Implementation:**
- All catch blocks must log with context and correlation ID
- All API errors return structured error response with `request_id`
- Job failures stored in `jobs.error_code` + `jobs.error_message`
- Scan failures set `scans.status = 'failed'` with reason

**What this means:**
- ✅ API error → user sees error message with reference ID
- ✅ Scan timeout → user sees "Scan timed out, please retry"
- ✅ AI API failure → logged with request ID, user sees fallback
- ❌ Never `catch (e) {}` (empty catch)
- ❌ Never return success when something failed
- ❌ Never hide errors to "not worry the user"

---

### 4. Never Zero Recommendations

**Principle:** Never return empty from API; use ranking, clustering, and progressive disclosure to avoid UI overload.

**Why:**
- "0 recommendations" makes users think the tool is broken
- Every website can be improved somehow
- Locked recommendations show value (upgrade motivation)
- But 50+ items would overwhelm users

**API Contract:**
- Return ALL recommendations (50+? Fine.)
- Include clusters, counts, and sorting metadata
- Never filter to zero based on plan or score
- Store ALL, control display with `is_locked`
- **`recommendations[]` array is ALWAYS non-empty** (actionable OR locked OR diagnostic)

**UI Contract:**
- Show "Top 5 Next Actions" (highest impact, lowest effort)
- Group remaining into clusters/plays (5-10 visible groups)
- Cap locked items at 3 inline + "+X more locked" count
- Progressive disclosure: expand clusters, paginate lists
- Allow filters: pillar, effort, impact, locked/unlocked
- **Never solve crowding by filtering in API** (that reintroduces "0 recs")

**Display Limits by Plan:**

| Plan | Unlocked Shown | Locked Teaser | Total Default | Expansion |
|------|----------------|---------------|---------------|-----------|
| Free | 3 | 3 | 6 max | "View X more" |
| DIY | 5 | 3 | 8 max | "View X more" |
| Pro | 10 | 3 | 13 max | "View X more" |
| Enterprise | 15 | 3 | 18 max | "View X more" |
| Agency | All | 0 | Smart grouping | Collapse by pillar |

**Sorting Default:**
1. Priority score (impact × confidence ÷ effort)
2. Quick wins first (low effort, high impact)
3. Then by pillar grouping

**Fallback (detector finds 0 issues):**
- Return 1-3 maintenance recommendations
- "Your site is well-optimized. Here's how to maintain it."

**What this means:**
- ✅ API returns 50 recs → UI shows Top 5 + 5-10 clusters
- ✅ Free user sees 3 unlocked + 3 locked + "+17 more locked"
- ✅ Score 950 → 1-3 maintenance tips (not empty)
- ✅ Clusters like "Help AI understand your business" reduce visual clutter
- ❌ Never empty API response
- ❌ Never 50 items dumped on screen
- ❌ Never all-locked wall of upgrade bait

---

### 5. Marketing-First Language

**Principle:** Default to plain language. Technical details available but opt-in.

**Why:**
- Primary users are marketers, not developers
- Technical jargon alienates target audience
- Implementation details can overwhelm initially

**Implementation:**
- `recommendations.marketing_copy` is default display
- `recommendations.technical_copy` shown on toggle/expand
- `recommendations.code_snippet` available for paid plans
- `user_preferences.recommendation_view` defaults to `'marketing'`
- All copy written outcome-first ("Get cited by AI" not "Add JSON-LD")
- **All plans default to marketing view** (paid users can toggle to technical, but start with same UX)

**What Gets Stored vs Displayed:**

| Content | Stored? | Free Default | Paid Default | On Toggle |
|---------|---------|--------------|--------------|-----------|
| WHY (outcome) | ✅ | ✅ Show | ✅ Show | ✅ Show |
| WHAT (action) | ✅ | ✅ Show | ✅ Show | ✅ Show |
| HOW (steps) | ✅ | 🔒 Locked | ✅ Available | ✅ Show |
| Code snippet | ✅ | 🔒 Locked | ✅ Available | ✅ Show |

**Entitlements by Plan:**

| Plan | Marketing Copy | Technical Copy | Code Snippets |
|------|----------------|----------------|---------------|
| Free | ✅ | ❌ | ❌ |
| DIY+ | ✅ | ✅ | ✅ |

**What this means:**
- ✅ Default view shows WHY and WHAT
- ✅ HOW and code available on toggle (for paid plans)
- ✅ "Help AI assistants understand your business" (marketing)
- ✅ "Add Organization schema markup" (technical, shown on expand)
- ❌ Never lead with code snippets
- ❌ Never use jargon without explanation
- ❌ Never assume user knows what "schema" means

---

### 6. Pillar Display: Marketing Headlines + Canonical Names

**Principle:** Use marketing-friendly headlines as primary display, keep canonical pillar names as subheadings for brand consistency. Internal IDs never change.

**Why:**
- Existing 8 pillar names are in PR, decks, and sales materials
- Marketing headlines make UI instantly clearer for non-technical users
- Gradual transition avoids breaking brand consistency
- Creates a migration path to simplify later

**Taxonomy (Three Layers):**

| Layer | Purpose | Changes? | Example |
|-------|---------|----------|---------|
| Internal ID | Database, scoring, code | ❌ NEVER | `schema_markup` |
| Canonical Name | PR, reports, exports | Rarely | "Schema Markup" |
| Marketing Headline | UI display | Can evolve | "Speak AI's Language" |

**The 8 Pillars:**

| # | Internal ID | Canonical Name | Marketing Headline | One-Liner |
|---|-------------|----------------|-------------------|-----------|
| 1 | `content_structure` | Content Structure | **Content AI Can Use** | Structure your content so AI can easily extract and cite it |
| 2 | `trust_authority` | Trust & Authority | **Be Trusted** | Build credibility signals that make AI comfortable recommending you |
| 3 | `entity_recognition` | Entity Recognition | **Be Found** | Make your brand unmistakable when AI identifies companies in your category |
| 4 | `schema_markup` | Schema Markup | **Speak AI's Language** | Help AI assistants understand exactly what your business does |
| 5 | `technical_setup` | Technical Setup | **Be Technically Solid** | Remove technical blockers that prevent indexing, parsing, and rendering |
| 6 | `speed_ux` | Speed & UX | **Be Fast & Frictionless** | Improve performance and experience—signals that influence visibility and trust |
| 7 | `voice_optimization` | Voice Optimization | **Own the Conversation** | Get recommended when customers ask AI out loud |
| 8 | `citation_worthiness` | Citation Worthiness | **Be Worth Quoting** | Give AI reasons to cite you as the authoritative source |

**UI Display Pattern:**
```
┌─────────────────────────────────────────────────────────────┐
│  🗣️ Speak AI's Language                                     │  ← Marketing (headline)
│     Schema Markup                                           │  ← Canonical (subheading)
│                                                             │
│     ████████████████████░░░░░  78%                          │
│                                                             │
│     Help AI assistants understand exactly what your         │
│     business does.                                          │
└─────────────────────────────────────────────────────────────┘
```

**Phase-Out Timeline:**

| Phase | When | Display |
|-------|------|---------|
| A | Now | Marketing headline (large) + Canonical name (subheading) |
| B | 6 months | Canonical name smaller/grayed |
| C | 12 months | Canonical name in tooltip only |
| D | 18 months | Marketing headline only, canonical internal |

**Implementation:**
- Store mapping in config (`pillar-display-map.json`)
- `show_canonical` flag controls subheading visibility
- Internal IDs (`schema_markup`, etc.) NEVER change in database or code
- Canonical names preserved for PR, reports, and external communications
- Marketing headlines can evolve without breaking anything

---

### 7. Org-Centric, Not User-Centric

**Principle:** Billing, domains, and limits are at organization level, not user level.

**Why:**
- Enables teams (Enterprise)
- Enables agencies (multi-client)
- Prevents per-user billing complexity

**Implementation:**
- `subscriptions` linked to `organizations`, not `users`
- `domains` linked to `organizations`, not `users`
- Usage tracked per `organization_id`
- Users can belong to multiple orgs

**What this means:**
- ✅ User signs up → personal org created automatically
- ✅ Enterprise user invites team → all share org's quota
- ✅ Agency manages clients → each client is separate org
- ❌ Never check `user.plan` (check `org.plan` via subscription)
- ❌ Never track usage by user ID alone

---

### 8. Period-Based Usage, Not Counter Reset

**Principle:** Usage is counted per billing period. No cron job resets.

**Why:**
- Cron failures cause quota bugs
- Period-based is self-healing
- Aligns with Stripe billing cycles

**Implementation:**
- `usage_periods` table with `period_start` and `period_end`
- `usage_events` table records each scan/action
- Usage = COUNT of events in current period
- No `scans_used_this_month` counter to reset

**Period Types:**

| Plan | Period Type | Resets |
|------|-------------|--------|
| Free | `calendar_month` | 1st of month, 00:00 UTC |
| Paid | `billing_cycle` | Stripe subscription date |

**Note:** All times are UTC for consistency and deterministic behavior. Users see their quota in their local timezone in the UI, but the underlying reset is always UTC-based.

**What this means:**
- ✅ Query: "How many scans this period?" → COUNT events in date range
- ✅ Period ends → next query automatically starts new period
- ✅ Stripe webhook updates `current_period_start/end`
- ❌ No cron job to reset counters
- ❌ No `UPDATE users SET scans_used = 0`

---

### 9. Version Everything

**Principle:** All outputs include version metadata for safe evolution.

**Why:**
- Allows algorithm improvements without breaking old data
- Enables A/B testing of scoring/recommendations
- Debugging requires knowing which version produced output

**Implementation:**
- `scan_results.engine_version` (e.g., "v5.2.1")
- `scan_results.scoring_model` (e.g., "v5")
- `recommendations.generator_version` (e.g., "2.1.0")
- `scan_evidence.evidence_version` (e.g., "1.0")

**What this means:**
- ✅ Old scans show "Scored with V5" 
- ✅ New algorithm → increment version, compare results
- ✅ Bug in generator → know which scans affected
- ❌ Never overwrite old results with new algorithm
- ❌ Never deploy scoring change without version bump

---

## Locked Decisions Summary

These decisions are FINAL for the rebuild. Do not revisit without version update.

| # | Decision | Value |
|---|----------|-------|
| 1 | Default scan scope | Site (page-level future-ready via `scan_pages` table) |
| 2 | Score scale | 0-1000 everywhere |
| 3 | Error handling | No silent failures |
| 4 | Recommendations | Never zero; API always non-empty; UI clusters + paginates |
| 5 | Language default | Marketing-first for all plans (technical opt-in) |
| 6 | Pillar taxonomy | 3 layers: internal ID → canonical name → marketing headline |
| 7 | Billing entity | Organization (not user) |
| 8 | Usage tracking | Period-based events, UTC timing (no cron reset) |
| 9 | Output versioning | All outputs versioned |

---

## How to Use This Document

1. **Before implementing:** Check if there's a principle that applies
2. **When in doubt:** Default to the principle
3. **If principle seems wrong:** Discuss before deviating, update document if changed
4. **Code review:** Reject PRs that violate principles without explicit approval

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `13-pillar-display-map.json` | Pillar name configuration |
| `10-entitlements.v1.json` | Plan limits and features (source of truth, nested structure) |
| `04-entitlements-config.js` | Plan limits (JS importable, flat keys) |
| `02-success-criteria.md` | Definition of "done" |
| `09-schema-governance.md` | Schema change rules |

**Note:** Entitlements JSON uses nested keys (`pageOptimization.enabled`), JS uses flat keys (`pageOptimizationEnabled`). JSON is the source of truth.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.2 | 2026-01-03 | FINAL: Removed conflicting `page_results` reference, fixed Entity Recognition one-liner, aligned entitlement flag naming (`pageOptimization.enabled`), added sign-off instruction |
| 2.1 | 2026-01-03 | Fixes: Pillar taxonomy clarified (3 layers), exact table name (`scan_pages`), explicit API non-empty contract, paid users default to marketing view, UTC confirmation |
| 2.0 | 2026-01-03 | Added: Pillar display mapping, expanded Never Zero with clustering, clarified Marketing-First includes HOW on toggle, confirmed page-level future-ready |
| 1.0 | 2026-01-03 | Initial locked version |

---

## Sign-off

| Role | Name | Date | Approved |
|------|------|------|----------|
| CEO/Product | Monali | | [ ] |
| Tech Lead | Arhan | | [ ] |

**To approve:** Check the box, add date, then commit and tag as `product-principles-v2.2`.
