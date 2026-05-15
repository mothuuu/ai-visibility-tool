const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function migrateAuthFields() {
  try {
    console.log('🔄 Adding auth-related fields to users table...');

    // Add email verification fields
    await pool.query(`
      DO $$ 
      BEGIN
        -- Add name column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='name'
        ) THEN
          ALTER TABLE users ADD COLUMN name VARCHAR(255);
        END IF;

        -- Add email_verified column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='email_verified'
        ) THEN
          ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT false;
        END IF;
        
        -- Add verification_token column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='verification_token'
        ) THEN
          ALTER TABLE users ADD COLUMN verification_token VARCHAR(255);
        END IF;
        
        -- Add reset_token column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='reset_token'
        ) THEN
          ALTER TABLE users ADD COLUMN reset_token VARCHAR(255);
        END IF;
        
        -- Add reset_token_expires column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='reset_token_expires'
        ) THEN
          ALTER TABLE users ADD COLUMN reset_token_expires TIMESTAMP;
        END IF;

        -- Add last_login column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='last_login'
        ) THEN
          ALTER TABLE users ADD COLUMN last_login TIMESTAMP;
        END IF;
      END $$;
    `);
    console.log('✅ Auth fields added successfully');

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_verification_token 
        ON users(verification_token) 
        WHERE verification_token IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_users_reset_token 
        ON users(reset_token) 
        WHERE reset_token IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_users_email_verified 
        ON users(email_verified);
    `);
    console.log('✅ Auth indexes created');

    console.log('🎉 Auth migration complete!');
    await pool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await pool.end();
    process.exit(1);
  }
}

migrateAuthFields();