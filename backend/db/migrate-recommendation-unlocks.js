const { Pool } = require('pg');
require('dotenv').config();

/**
 * Migration: recommendation_unlocks
 *
 * Persists a paid recommendation unlock (token spend + generated artifact) so it
 * is served forever without regenerating or re-charging. Keyed per (user, scan,
 * type): a rescan produces a fresh lockable state (cross-rescan carryover is a
 * later policy decision, out of scope for v1).
 *
 * Run: node db/migrate-recommendation-unlocks.js
 * Idempotent (CREATE TABLE / INDEX IF NOT EXISTS).
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
    rejectUnauthorized: false
  }
});

async function migrateRecommendationUnlocks() {
  try {
    console.log('🔄 Creating recommendation_unlocks table...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS recommendation_unlocks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        scan_id INTEGER NOT NULL REFERENCES scans(id),
        recommendation_type VARCHAR(50) NOT NULL,   -- 'schema'
        tokens_spent INTEGER NOT NULL,
        artifact JSONB NOT NULL,                     -- generated deliverable, persisted verbatim
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, scan_id, recommendation_type)
      );
    `);
    console.log('✅ recommendation_unlocks table created');

    // Lookups are always by (user, scan[, type]); the UNIQUE constraint already
    // provides that composite index. Add a scan_id index for admin/analytics.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_recommendation_unlocks_scan
        ON recommendation_unlocks(scan_id);
    `);
    console.log('✅ Indexes created');

    console.log('✅ recommendation_unlocks migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

migrateRecommendationUnlocks();
