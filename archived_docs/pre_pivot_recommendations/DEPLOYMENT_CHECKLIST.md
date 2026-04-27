> ⚠️ **ARCHIVED (Pre-Pivot)** — This document describes the old recommendation lifecycle system that was removed in Phase 1. It does not reflect the current production architecture. For current documentation, see DOCS_INDEX.md at repo root.

---

# Recommendation Delivery System - Deployment Checklist

## ✅ What Has Been Implemented

### Backend Services (Complete)

✓ **Core Services** (`/backend/services/`)
- `impact-score-calculator.js` - Calculates recommendation priority scores
- `mode-transition-service.js` - Handles Optimization ↔ Elite mode transitions
- `notification-service.js` - Creates and manages user notifications
- `auto-detection-service.js` - Detects implementations by comparing scans
- `refresh-cycle-service.js` - Manages 5-day recommendation refresh cycles
- `elite-recommendation-generator.js` - Generates Elite mode recommendations
- `scan-completion-hook.js` - Integrates all services on scan completion
- `cron-service.js` - Scheduled tasks (refresh cycles, cleanup, plateau detection)

✓ **API Endpoints** (`/backend/routes/recommendations.js` - extended)
- `POST /:id/skip` - Skip a recommendation
- `POST /refresh/:scanId` - Manual refresh trigger
- `GET /refresh-status/:scanId` - Get refresh cycle status
- `GET /notifications` - Get user notifications
- `POST /notifications/:id/read` - Mark notification as read
- `POST /notifications/:id/dismiss` - Dismiss notification
- `POST /notifications/mark-all-read` - Mark all notifications as read

✓ **Database Schema** (`/backend/db/migrate-recommendation-delivery-system.js`)
- All 13 new/updated tables created
- Indexes for performance
- Triggers for timestamp updates

✓ **Documentation**
- `RECOMMENDATION_DELIVERY_SYSTEM.md` - Comprehensive system documentation
- `DEPLOYMENT_CHECKLIST.md` - This file

---

## 🚀 Deployment Steps

### 1. Install Dependencies

```bash
cd backend
npm install node-cron
```

**Why:** The cron service requires `node-cron` for scheduled tasks.

---

### 2. Run Database Migration

```bash
cd backend
node db/migrate-recommendation-delivery-system.js
```

**What it does:**
- Creates 13 new database tables
- Adds columns to existing tables
- Creates indexes and triggers
- Sets up constraints

**Verify:**
```sql
-- Check if tables were created
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'recommendation_refresh_cycles',
  'implementation_detections',
  'user_modes',
  'mode_transition_history',
  'score_history',
  'competitive_tracking',
  'competitive_alerts',
  'recommendation_replacements',
  'page_selection_history',
  'user_notifications'
);
```

---

### 3. Integrate Cron Service

**File:** `/backend/server.js`

**Add at top:**
```javascript
const { getCronService } = require('./services/cron-service');
```

**Add after server starts:**
```javascript
// Start cron services
const cronService = getCronService();
cronService.start();

console.log('✅ Cron services started');
```

**Add graceful shutdown:**
```javascript
// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, stopping cron services...');
  cronService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, stopping cron services...');
  cronService.stop();
  process.exit(0);
});
```

---

### 4. Integrate Scan Completion Hook

**File:** `/backend/routes/scan.js` (or wherever scans are processed)

**Add at top:**
```javascript
const ScanCompletionHook = require('../services/scan-completion-hook');
```

**Add after scan completes successfully:**
```javascript
// After scan status is set to 'completed' and saved
if (scan.status === 'completed') {
  // Trigger recommendation delivery system
  const scanHook = new ScanCompletionHook(db.pool);

  await scanHook.onScanComplete(userId, scan.id, {
    total_score: scan.total_score,
    ai_readability_score: scan.ai_readability_score,
    ai_search_readiness_score: scan.ai_search_readiness_score,
    content_freshness_score: scan.content_freshness_score,
    content_structure_score: scan.content_structure_score,
    speed_ux_score: scan.speed_ux_score,
    technical_setup_score: scan.technical_setup_score,
    trust_authority_score: scan.trust_authority_score,
    voice_optimization_score: scan.voice_optimization_score,
    detailed_analysis: scan.detailed_analysis
  });
}
```

**What this does:**
1. Records score history for tracking
2. Checks for mode transitions (Optimization ↔ Elite)
3. Runs auto-detection to find implementations
4. Calculates impact scores for recommendations
5. Generates Elite recommendations if user is in Elite mode
6. Initializes refresh cycle

---

### 5. Update Existing Mark Complete Endpoint

**File:** `/backend/routes/recommendations.js`

**Update the existing `mark-complete` endpoint** to use the new `status` field instead of `unlock_state`:

```javascript
// Change this:
await db.query(
  `UPDATE scan_recommendations
   SET unlock_state = 'completed',
       marked_complete_at = CURRENT_TIMESTAMP
   WHERE id = $1`,
  [recId]
);

// To this:
await db.query(
  `UPDATE scan_recommendations
   SET status = 'implemented',
       implemented_at = CURRENT_TIMESTAMP
   WHERE id = $1`,
  [recId]
);
```

---

### 6. Environment Variables

**File:** `.env`

No new environment variables are required. The system uses the existing `DATABASE_URL`.

---

## 🧪 Testing

### Test 1: Database Migration

```bash
# Run migration
node backend/db/migrate-recommendation-delivery-system.js

# Expected output:
# ✅ Migration completed successfully!
```

**Troubleshoot:**
- If connection fails, check `DATABASE_URL` in `.env`
- If tables already exist, migration will skip them (safe to re-run)

---

### Test 2: Cron Service

**Start server and check logs:**
```bash
npm start

# Expected in logs:
# 🕐 Starting cron services...
# ✅ Started 3 cron jobs
```

**Manual trigger (for testing):**
```javascript
// In node REPL or test script
const { getCronService } = require('./backend/services/cron-service');
const cronService = getCronService();

// Test refresh cycle check
await cronService.manualRefreshCycleCheck();

// Test plateau detection
await cronService.manualPlateauCheck();
```

---

### Test 3: Scan Completion Hook

**Complete a scan and check logs:**

Expected output:
```
🔗 Running scan completion hook for scan 123...
  📊 Recording score history...
     ✓ Score history recorded (score: 750, delta: 25)
  🔄 Checking mode transition...
     ✓ Mode unchanged: optimization
  🔍 Running auto-detection...
     ✓ Detected 2 implementation(s)
  📈 Calculating impact scores...
     ✓ Calculated impact scores for 15 recommendations
  🌟 Checking Elite mode recommendations...
     ✓ User not in Elite mode, skipping
  🔄 Checking refresh cycle...
     ✓ Refresh cycle initialized
✅ Scan completion hook finished successfully
```

---

### Test 4: API Endpoints

**Test Skip Recommendation:**
```bash
curl -X POST http://localhost:3001/api/recommendations/123/skip \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

# Expected:
# { "success": true, "message": "Recommendation skipped" }
```

**Test Get Notifications:**
```bash
curl http://localhost:3001/api/recommendations/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected:
# { "success": true, "notifications": [...], "unreadCount": 3 }
```

**Test Refresh Status:**
```bash
curl http://localhost:3001/api/recommendations/refresh-status/123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected:
# {
#   "success": true,
#   "refreshStatus": {
#     "currentCycle": 1,
#     "daysUntilRefresh": 4,
#     "stats": {...}
#   }
# }
```

---

### Test 5: Auto-Detection

**Scenario:** User implements FAQ schema without marking it

1. Complete initial scan → User gets FAQ recommendation
2. User adds FAQ schema to their site (without clicking "Mark Implemented")
3. User runs new scan
4. Check logs for auto-detection:

```
🔍 Running auto-detection...
   ✓ Detected 1 implementation(s)
```

5. Check notifications:
```bash
curl http://localhost:3001/api/recommendations/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Should see:
# {
#   "title": "✓ Implementation Detected!",
#   "message": "Great work! We detected you implemented improvements..."
# }
```

---

### Test 6: Mode Transition

**Scenario:** User reaches 850 score

1. Create test user with score 840
2. Run scan that improves score to 855
3. Check logs:

```
🔄 Checking mode transition...
   ✓ Mode transition: optimization → elite_maintenance
```

4. Check notifications for Elite welcome message
5. Verify user_modes table:

```sql
SELECT current_mode, score_at_mode_entry
FROM user_modes
WHERE user_id = X;

-- Should show:
-- current_mode: 'elite_maintenance'
-- score_at_mode_entry: 855
```

---

### Test 7: Refresh Cycle

**Scenario:** 5 days pass with implemented recommendations

1. Create test scan with 10 recommendations
2. Mark 3 as implemented, 2 as skipped
3. Set `next_cycle_date` to yesterday (simulate 5 days passed):

```sql
UPDATE recommendation_refresh_cycles
SET next_cycle_date = CURRENT_DATE - INTERVAL '1 day'
WHERE scan_id = X;
```

4. Run cron job manually:
```javascript
const { getCronService } = require('./backend/services/cron-service');
await getCronService().manualRefreshCycleCheck();
```

5. Verify 5 new recommendations are active
6. Check notification for "🔄 New Recommendations Available"

---

## 🔍 Monitoring

### Check Cron Job Status

```javascript
GET /api/admin/cron-status

// Add this endpoint to a new admin route if needed
router.get('/cron-status', authenticateToken, requireAdmin, (req, res) => {
  const { getCronService } = require('../services/cron-service');
  const status = getCronService().getStatus();
  res.json(status);
});
```

### Monitor Refresh Cycles

```sql
-- See all refresh cycles
SELECT
  u.email,
  s.url,
  rrc.cycle_number,
  rrc.next_cycle_date,
  rrc.implemented_count,
  rrc.skipped_count,
  rrc.replaced_count
FROM recommendation_refresh_cycles rrc
JOIN scans s ON rrc.scan_id = s.id
JOIN users u ON s.user_id = u.id
ORDER BY rrc.next_cycle_date ASC;
```

### Monitor Auto-Detections

```sql
-- See recent auto-detections
SELECT
  u.email,
  sr.title as recommendation,
  id.detection_type,
  id.confidence_score,
  id.score_delta,
  id.detected_at
FROM implementation_detections id
JOIN scan_recommendations sr ON id.recommendation_id = sr.id
JOIN users u ON id.user_id = u.id
ORDER BY id.detected_at DESC
LIMIT 20;
```

### Monitor Mode Transitions

```sql
-- See mode transition history
SELECT
  u.email,
  mth.from_mode,
  mth.to_mode,
  mth.score_at_transition,
  mth.transitioned_at
FROM mode_transition_history mth
JOIN users u ON mth.user_id = u.id
ORDER BY mth.transitioned_at DESC
LIMIT 20;
```

---

## 🐛 Troubleshooting

### Issue: Cron jobs not running

**Symptoms:**
- Refresh cycles not processing
- Notifications not cleaning up

**Check:**
```javascript
const { getCronService } = require('./backend/services/cron-service');
console.log(getCronService().getStatus());
```

**Fix:**
1. Ensure cron service was started in `server.js`
2. Check for errors in server logs
3. Verify `node-cron` is installed: `npm list node-cron`

---

### Issue: Auto-detection not working

**Symptoms:**
- No detections even when users implement changes
- Empty `implementation_detections` table

**Check:**
1. Are there previous scans to compare?
```sql
SELECT COUNT(*) FROM scans WHERE user_id = X AND status = 'completed';
```

2. Are there active recommendations?
```sql
SELECT COUNT(*) FROM scan_recommendations WHERE scan_id = X AND status = 'active';
```

3. Did scores improve?
```sql
SELECT scan_id, total_score, score_delta FROM score_history
WHERE user_id = X ORDER BY scan_date DESC LIMIT 5;
```

**Debug:**
```javascript
const AutoDetectionService = require('./backend/services/auto-detection-service');
const service = new AutoDetectionService();
const detections = await service.detectImplementations(userId, scanId);
console.log('Detections:', detections);
```

---

### Issue: Mode not transitioning

**Symptoms:**
- User at 850+ but still in Optimization mode
- User at <800 but still in Elite mode

**Check:**
```sql
SELECT
  um.current_mode,
  um.current_score,
  um.in_buffer_zone,
  s.total_score
FROM user_modes um
JOIN users u ON um.user_id = u.id
JOIN scans s ON s.user_id = u.id
WHERE u.id = X
ORDER BY s.created_at DESC
LIMIT 1;
```

**Fix:**
Force transition manually:
```javascript
const ModeTransitionService = require('./backend/services/mode-transition-service');
const service = new ModeTransitionService();
await service.forceTransition(userId, 'elite_maintenance', 'manual_correction');
```

---

### Issue: Recommendations not refreshing

**Symptoms:**
- 5+ days passed but no new recommendations
- `next_cycle_date` is in the past

**Check:**
```sql
SELECT * FROM recommendation_refresh_cycles
WHERE next_cycle_date < CURRENT_DATE
ORDER BY next_cycle_date ASC;
```

**Fix:**
Manually trigger refresh:
```bash
curl -X POST http://localhost:3001/api/recommendations/refresh/SCAN_ID \
  -H "Authorization: Bearer JWT_TOKEN"
```

Or run cron manually:
```javascript
const { getCronService } = require('./backend/services/cron-service');
await getCronService().manualRefreshCycleCheck();
```

---

## 📋 Post-Deployment Checklist

- [ ] Database migration completed successfully
- [ ] All 13 tables created and indexed
- [ ] Cron service integrated in `server.js`
- [ ] Scan completion hook integrated in scan route
- [ ] `node-cron` dependency installed
- [ ] Server starts without errors
- [ ] Cron jobs show as "active" in logs
- [ ] Test scan completion triggers hook
- [ ] Test auto-detection with two scans
- [ ] Test mode transition at 850 score
- [ ] Test skip recommendation endpoint
- [ ] Test notifications endpoint
- [ ] Test refresh cycle (manual trigger)
- [ ] Monitor logs for errors for 24 hours
- [ ] Check `score_history` table populates correctly
- [ ] Verify refresh cycles create correctly

---

## 🎉 Success Metrics

After deployment, monitor these metrics:

### Week 1
- [ ] At least 10 refresh cycles processed
- [ ] At least 5 auto-detections triggered
- [ ] At least 2 mode transitions occurred
- [ ] Zero cron job failures
- [ ] Zero database errors

### Week 2
- [ ] Users receiving notifications
- [ ] Recommendations being skipped/implemented
- [ ] Elite mode users seeing competitive recommendations
- [ ] Plateau detection identifying stuck users
- [ ] No performance degradation from cron jobs

### Month 1
- [ ] 50+ auto-detections with 70%+ confidence
- [ ] 20+ mode transitions
- [ ] 100+ refresh cycles completed
- [ ] Active user engagement with skip/implement actions
- [ ] Elite users tracking competitors

---

## 🆘 Support

If you encounter issues:

1. **Check logs** - Most issues show clear error messages
2. **Check documentation** - `RECOMMENDATION_DELIVERY_SYSTEM.md` has detailed troubleshooting
3. **Query database** - Use the monitoring SQL queries above
4. **Manual testing** - Use the test scripts in the Testing section
5. **Rollback** - If critical failure, the migration can be reversed (see below)

### Rollback (Emergency Only)

```sql
-- Drop new tables (in reverse order due to foreign keys)
DROP TABLE IF EXISTS user_notifications;
DROP TABLE IF EXISTS page_selection_history;
DROP TABLE IF EXISTS recommendation_replacements;
DROP TABLE IF EXISTS competitive_alerts;
DROP TABLE IF EXISTS competitive_tracking;
DROP TABLE IF EXISTS score_history;
DROP TABLE IF EXISTS mode_transition_history;
DROP TABLE IF EXISTS user_modes;
DROP TABLE IF EXISTS implementation_detections;
DROP TABLE IF EXISTS recommendation_refresh_cycles;

-- Remove added columns from existing tables
ALTER TABLE scan_recommendations
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS skipped_at,
  -- ... (all new columns)

ALTER TABLE user_progress
  DROP COLUMN IF EXISTS current_mode,
  -- ... (all new columns)
```

---

**Last Updated:** 2025-11-16
**Version:** 1.0.0
**Status:** ✅ Ready for Deployment
