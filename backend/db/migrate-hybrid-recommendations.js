const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function migrateHybridRecommendations() {
  console.log('🔄 Migrating to hybrid recommendation system...\n');
  
  try {
    // ============================================
    // STEP 1: Add columns to scan_recommendations
    // ============================================
    console.log('📝 Step 1: Adding hybrid columns to scan_recommendations...');
    
    await pool.query(`
      ALTER TABLE scan_recommendations 
      ADD COLUMN IF NOT EXISTS recommendation_type VARCHAR(20) DEFAULT 'page-specific',
      ADD COLUMN IF NOT EXISTS page_url TEXT,
      ADD COLUMN IF NOT EXISTS page_priority INTEGER,
      ADD COLUMN IF NOT EXISTS skip_enabled_at TIMESTAMP;
    `);
    
    console.log('   ✅ Added columns:');
    console.log('      - recommendation_type (site-wide or page-specific)');
    console.log('      - page_url (NULL for site-wide, specific URL for page)');
    console.log('      - page_priority (user ranking 1-5)');
    console.log('      - skip_enabled_at (when skip becomes available)\n');
    
    // Add comment explaining types
    await pool.query(`
      COMMENT ON COLUMN scan_recommendations.recommendation_type IS 
      'Types: site-wide (affects whole site), page-specific (affects single page)';
    `);
    
    // ============================================
    // STEP 2: Update user_progress table
    // ============================================
    console.log('📝 Step 2: Adding site-wide tracking to user_progress...');
    
    await pool.query(`
      ALTER TABLE user_progress
      ADD COLUMN IF NOT EXISTS site_wide_total INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS site_wide_completed INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS site_wide_active INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS page_specific_total INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS page_specific_completed INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS current_page_url TEXT,
      ADD COLUMN IF NOT EXISTS site_wide_complete BOOLEAN DEFAULT false;
    `);
    
    console.log('   ✅ Added columns:');
    console.log('      - site_wide_total, site_wide_completed, site_wide_active');
    console.log('      - page_specific_total, page_specific_completed');
    console.log('      - current_page_url (which page is currently unlocked)');
    console.log('      - site_wide_complete (flag for when to unlock pages)\n');
    
    // ============================================
    // STEP 3: Create page_priorities table
    // ============================================
    console.log('📝 Step 3: Creating page_priorities table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS page_priorities (
        id SERIAL PRIMARY KEY,
        scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        page_url TEXT NOT NULL,
        priority_rank INTEGER NOT NULL,
        
        -- Page info
        page_score INTEGER,
        total_recommendations INTEGER DEFAULT 0,
        completed_recommendations INTEGER DEFAULT 0,
        unlocked BOOLEAN DEFAULT false,
        unlocked_at TIMESTAMP,
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        -- Unique constraint
        UNIQUE(scan_id, page_url)
      )
    `);
    
    console.log('   ✅ Table created with columns:');
    console.log('      - page_url, priority_rank (1-5)');
    console.log('      - page_score, recommendation counts');
    console.log('      - unlocked flag and timestamp\n');
    
    // Add indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_page_priorities_scan_id 
        ON page_priorities(scan_id);
      CREATE INDEX IF NOT EXISTS idx_page_priorities_rank 
        ON page_priorities(scan_id, priority_rank);
    `);
    
    console.log('   ✅ Indexes created\n');
    
    // Add trigger for updated_at
    await pool.query(`
      DROP TRIGGER IF EXISTS update_page_priorities_updated_at ON page_priorities;
      CREATE TRIGGER update_page_priorities_updated_at
        BEFORE UPDATE ON page_priorities
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);
    
    console.log('   ✅ Auto-update trigger added\n');
    
    // ============================================
    // STEP 4: Add indexes for new columns
    // ============================================
    console.log('📝 Step 4: Creating indexes for performance...');
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_scan_recommendations_type 
        ON scan_recommendations(scan_id, recommendation_type);
      CREATE INDEX IF NOT EXISTS idx_scan_recommendations_page 
        ON scan_recommendations(scan_id, page_url) WHERE page_url IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_scan_recommendations_priority 
        ON scan_recommendations(scan_id, page_priority);
    `);
    
    console.log('   ✅ Performance indexes created\n');
    
    // ============================================
    // SUMMARY
    // ============================================
    console.log('═══════════════════════════════════════════════════');
    console.log('🎉 HYBRID RECOMMENDATION MIGRATION COMPLETE! 🎉');
    console.log('═══════════════════════════════════════════════════\n');
    
    console.log('📊 Database Changes Summary:');
    console.log('   1. ✅ scan_recommendations: 4 new columns');
    console.log('      - recommendation_type (site-wide/page-specific)');
    console.log('      - page_url, page_priority, skip_enabled_at');
    console.log('   2. ✅ user_progress: 7 new columns');
    console.log('      - Site-wide tracking');
    console.log('      - Page-specific tracking');
    console.log('      - Current page tracking');
    console.log('   3. ✅ page_priorities: New table');
    console.log('      - Tracks user page ranking');
    console.log('      - Tracks unlock status per page');
    console.log('   4. ✅ Performance indexes added\n');
    
    console.log('🎯 Ready for:');
    console.log('   - Site-wide recommendation generation');
    console.log('   - Page-specific recommendation generation');
    console.log('   - Page priority system');
    console.log('   - Skip functionality (after 5 days)');
    console.log('   - Progressive unlock by page priority\n');
    
    await pool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('\nError details:', error.message);
    await pool.end();
    process.exit(1);
  }
}

migrateHybridRecommendations();