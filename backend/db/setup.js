const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function setupDatabase() {
  try {
    console.log('🔄 Setting up database tables...');

    // Brand facts table (for identity layer)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brand_facts (
        brand_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_name VARCHAR(255),
        domain VARCHAR(255) UNIQUE NOT NULL,
        same_as JSONB DEFAULT '[]',
        wikidata_id VARCHAR(100),
        crunchbase_url VARCHAR(255),
        socials JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Brand facts table created');
    
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        plan VARCHAR(50) DEFAULT 'free',
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        scans_used_this_month INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Users table created');

    // Scans table with page tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        brand_id UUID REFERENCES brand_facts(brand_id),
        user_id INTEGER REFERENCES users(id),
        url VARCHAR(500) NOT NULL,
        score INTEGER,
        industry VARCHAR(100),
        scan_data JSONB,
        pages_scanned JSONB DEFAULT '[]',
        page_count INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Scans table created');
    
    // Add new columns to existing scans table (if they don't exist)
    await pool.query(`
      DO $$ 
      BEGIN
        -- Add pages_scanned column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='scans' AND column_name='pages_scanned'
        ) THEN
          ALTER TABLE scans ADD COLUMN pages_scanned JSONB DEFAULT '[]';
        END IF;
        
        -- Add page_count column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='scans' AND column_name='page_count'
        ) THEN
          ALTER TABLE scans ADD COLUMN page_count INTEGER DEFAULT 1;
        END IF;
      END $$;
    `);
    console.log('✅ Scans table columns updated');

    // Page-level analysis table for DIY/Pro
    await pool.query(`
      CREATE TABLE IF NOT EXISTS page_analysis (
        id SERIAL PRIMARY KEY,
        scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
        page_url VARCHAR(500) NOT NULL,
        page_score INTEGER,
        page_data JSONB,
        recommendations JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Page analysis table created');

    // Usage logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(100),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Usage logs table created');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id);
      CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at);
      CREATE INDEX IF NOT EXISTS idx_page_analysis_scan ON page_analysis(scan_id);
    `);
    console.log('✅ Indexes created');

    console.log('🎉 Database setup complete!');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    await pool.end();
    process.exit(1);
  }
}

setupDatabase();