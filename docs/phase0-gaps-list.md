# Phase 0: Gaps List

## Overview

This document catalogs all identified gaps between expected functionality and actual implementation.

---

## Database Schema Gaps

| Area | Expected | Actual | Gap Type | Priority |
|------|----------|--------|----------|----------|
| `directories.pricing_model` | Column exists | May be missing in original migration | DB Schema | High |
| `campaign_runs.directories_in_progress` | Column exists | Added in later migration | DB Schema | Medium |
| `directory_submissions.action_type` | Column exists | Added in later migration | DB Schema | Medium |
| `directory_submissions.action_url` | Column exists | Added in campaign-runs migration | DB Schema | Medium |
| `directory_submissions.action_deadline` | Column exists | Added in later migration | DB Schema | Medium |
| `credential_vault.handoff_*` | Columns exist | May need separate migration | DB Schema | Medium |
| `credential_access_log` | Table exists | May not be created | DB Schema | Low |
| Status values | Consistent 'action_needed' | Both 'action_needed' and 'needs_action' in code | Data Consistency | High |

---

## API Gaps

| Area | Expected | Actual | Gap Type | Priority |
|------|----------|--------|----------|----------|
| Campaign pause/resume/cancel | UI controls | No frontend UI for these actions | UI Feature | Low |
| Directories preview | User can browse | `/directories` endpoint not called by frontend | UI Feature | Low |
| Credential password reveal | Secure reveal | Endpoint disabled (503) | Security (intentional) | N/A |
| Webhook for pack purchases | Handles packs | Handler exists but needs verification | Integration | Medium |

---

## Worker Gaps

| Area | Expected | Actual | Gap Type | Priority |
|------|----------|--------|----------|----------|
| Automated submission | Worker submits to directories | Worker only marks as action_needed | Core Feature | Critical |
| API integrations | Directory-specific APIs | submitViaAPI() is placeholder | Core Feature | Critical |
| Form automation | Fill forms automatically | Not implemented | Core Feature | High |
| Puppeteer/browser automation | Automate web submissions | Not implemented | Core Feature | High |
| Status tracking | Track approval status | Manual process | Core Feature | Medium |
| Live verification | Check if listing is live | Not implemented | Core Feature | Medium |

---

## Data Gaps

| Area | Expected | Actual | Gap Type | Priority |
|------|----------|--------|----------|----------|
| Directories seeded | Database populated | Unknown - needs verification | Data | Critical |
| Directory submission URLs | Valid URLs for each | Unknown - needs verification | Data | High |
| Directory required fields | Accurate per directory | Generic defaults | Data Quality | Medium |
| Category mappings | Map our categories to theirs | Not populated | Data Quality | Medium |
| Pricing model column | All directories have value | May be NULL | Data Quality | High |
| Validation status | Directories validated regularly | Never updated | Data Quality | Low |

---

## UI Gaps

| Area | Expected | Actual | Gap Type | Priority |
|------|----------|--------|----------|----------|
| Status display | 'action_needed' shows correctly | Was showing 'Queued' (fixed) | UI Bug | Fixed |
| Campaign controls | Pause/Resume/Cancel buttons | Not visible in UI | UI Feature | Low |
| Submission details | View submission details | Basic list only | UI Feature | Low |
| Credential management | Full credential CRUD | View-only with handoff | UI Feature | Low |
| Action deadline display | Show time remaining | Not prominent | UI UX | Medium |
| Bulk actions | Mark multiple as complete | Not implemented | UI Feature | Low |

---

## Security Gaps

| Area | Expected | Actual | Gap Type | Priority |
|------|----------|--------|----------|----------|
| Password encryption | Passwords encrypted at rest | Uses `password_encrypted` column (needs verification) | Security | High |
| Audit logging | All credential access logged | `credential_access_log` may not exist | Security | Medium |
| Rate limiting | All sensitive endpoints limited | Only credentials endpoints | Security | Low |
| Password reveal | Secure, logged reveal | Disabled (503) | Security | N/A |

---

## Integration Gaps

| Area | Expected | Actual | Gap Type | Priority |
|------|----------|--------|----------|----------|
| Stripe webhook | Handles all payment events | Handles checkout.session.completed | Integration | Low |
| Email notifications | Notify on action needed | Reminder job exists but email sending unclear | Integration | Medium |
| Notification preferences | User can set preferences | Table may not exist | Integration | Low |
| 2FA for credentials | Support 2FA tokens | Not implemented | Integration | Low |

---

## Operational Gaps

| Area | Expected | Actual | Gap Type | Priority |
|------|----------|--------|----------|----------|
| Worker monitoring | Dashboard for worker status | getStatus() exists but no UI | Ops | Low |
| Error alerting | Alert on failures | Console logging only | Ops | Medium |
| Metrics collection | Track success rates | Not implemented | Ops | Low |
| Directory validation | Regular URL validation | Not automated | Ops | Low |

---

## Priority Summary

### Critical (Must Fix)
1. **Worker doesn't actually submit** - Core feature missing
2. **Directories may not be seeded** - System non-functional without data
3. **API integrations not built** - submitViaAPI() is placeholder

### High Priority
1. Status value inconsistency ('action_needed' vs 'needs_action')
2. Missing pricing_model column values
3. Form/browser automation not implemented
4. Password encryption verification needed

### Medium Priority
1. Missing campaign_runs columns (may cause errors)
2. Email notifications unclear
3. Directory data quality (URLs, required fields)
4. Error alerting needed

### Low Priority
1. UI enhancements (campaign controls, bulk actions)
2. Additional rate limiting
3. Monitoring and metrics
4. Notification preferences

---

## Quick Wins (Easy Fixes)

1. ✅ Status display mapping (already fixed)
2. Add missing columns via migration (straightforward)
3. Seed directories table with initial data
4. Enable worker in production (env var)
5. Verify password encryption method
