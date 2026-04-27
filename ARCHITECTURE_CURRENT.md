# Visible2AI — Current Architecture (Phase 1)

## System Overview
Scans → Findings → Tokens → Packs (Phase 2)

The old recommendation lifecycle (active/locked/implemented, drip unlock, backfill, cap enforcement) has been removed. Replaced by a findings-based diagnostic display with token-gated execution packs.

## Active Endpoints
- POST /api/auth/* — Authentication (signup, login, verify, refresh, reset)
- GET/POST /api/scans — Scan initiation and results
- GET /api/scans/:scanId/findings — Findings with plan-based filtering
- GET /api/tokens/balance — Token balance
- GET /api/tokens/transactions — Token transaction history
- POST /api/tokens/purchase — Token top-up checkout session
- POST /api/webhooks/stripe — Subscription + token purchase webhooks

## Plans
- Free ($0): Snapshot scan, 3 findings teaser, no tokens
- Starter ($29/mo): Full findings, biweekly citation monitoring, 60 tokens/cycle
- Pro ($99/mo): Everything + competitors, weekly monitoring, 200 tokens/cycle
- 'diy' is treated as 'starter' everywhere (backward compatibility)

## Token Rules
- All tokens (monthly + purchased) expire at billing cycle end — no rollover
- Spend order: monthly first, then purchased
- Free tier cannot earn or purchase tokens

## Key Services
- PlanService — plan entitlements, normalization (diy→starter, freemium→free)
- TokenService — balance, spend, grant, expiry with row-level locking
- FindingsService + findingsExtractor — scan completion → findings generation

## Database (new tables added in Phase 1)
- findings, evidence_snapshots
- token_balances, token_transactions, pack_purchases

## What Was Removed
- Recommendation backfill, drip unlock, cap enforcement, promotion/demotion
- /api/recommendations endpoint
- All recommendation UI (replaced by Findings tab)
- scan_recommendations table still exists (historical data) but nothing writes to it

## What's Preserved for Phase 2
- /phase2_preserved/ — recommendation generation logic (playbook map, detection states, evidence helpers, renderer) to be adapted into pack generation engine

## Scheduled Jobs
- Token expiry cron — daily midnight UTC, expires tokens for ended billing cycles
- Submission worker — background scan processing
- Citation reminder — daily at 9am UTC
