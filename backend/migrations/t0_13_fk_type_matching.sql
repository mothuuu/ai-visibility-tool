-- Migration: T0-13 FK Type Matching
-- Date: 2025-01-01
-- Description: Creates directory_orders table with FK type matching users.id exactly
--
-- CRITICAL: This migration detects the type of users.id (INTEGER, BIGINT, UUID)
-- and creates directory_orders.user_id with the EXACT same type.
-- Type mismatch breaks FK constraints.

DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  -- Skip if table already exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'directory_orders') THEN
    RAISE NOTICE 'Table directory_orders already exists, skipping creation';
    RETURN;
  END IF;

  -- Detect users.id type
  SELECT data_type INTO user_id_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'id';

  RAISE NOTICE 'Detected users.id type: %', user_id_type;

  -- Create table with matching FK type
  IF user_id_type = 'integer' THEN
    CREATE TABLE directory_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_profile_id INTEGER REFERENCES business_profiles(id),
      stripe_checkout_session_id VARCHAR(255) UNIQUE,
      stripe_session_id VARCHAR(255) UNIQUE,
      stripe_payment_intent_id VARCHAR(255),
      stripe_price_id VARCHAR(255),
      order_type VARCHAR(50) NOT NULL DEFAULT 'starter',
      pack_type VARCHAR(50),
      amount_cents INTEGER,
      price_paid INTEGER,
      currency VARCHAR(10) DEFAULT 'usd',
      directories_allocated INTEGER NOT NULL DEFAULT 100,
      directories_submitted INTEGER NOT NULL DEFAULT 0,
      directories_live INTEGER DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      paid_at TIMESTAMP,
      delivery_started_at TIMESTAMP,
      completed_at TIMESTAMP,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT dir_orders_submitted_check CHECK (directories_submitted <= directories_allocated)
    );
  ELSIF user_id_type = 'bigint' THEN
    CREATE TABLE directory_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_profile_id INTEGER REFERENCES business_profiles(id),
      stripe_checkout_session_id VARCHAR(255) UNIQUE,
      stripe_session_id VARCHAR(255) UNIQUE,
      stripe_payment_intent_id VARCHAR(255),
      stripe_price_id VARCHAR(255),
      order_type VARCHAR(50) NOT NULL DEFAULT 'starter',
      pack_type VARCHAR(50),
      amount_cents INTEGER,
      price_paid INTEGER,
      currency VARCHAR(10) DEFAULT 'usd',
      directories_allocated INTEGER NOT NULL DEFAULT 100,
      directories_submitted INTEGER NOT NULL DEFAULT 0,
      directories_live INTEGER DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      paid_at TIMESTAMP,
      delivery_started_at TIMESTAMP,
      completed_at TIMESTAMP,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT dir_orders_submitted_check CHECK (directories_submitted <= directories_allocated)
    );
  ELSIF user_id_type = 'uuid' THEN
    CREATE TABLE directory_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_profile_id INTEGER REFERENCES business_profiles(id),
      stripe_checkout_session_id VARCHAR(255) UNIQUE,
      stripe_session_id VARCHAR(255) UNIQUE,
      stripe_payment_intent_id VARCHAR(255),
      stripe_price_id VARCHAR(255),
      order_type VARCHAR(50) NOT NULL DEFAULT 'starter',
      pack_type VARCHAR(50),
      amount_cents INTEGER,
      price_paid INTEGER,
      currency VARCHAR(10) DEFAULT 'usd',
      directories_allocated INTEGER NOT NULL DEFAULT 100,
      directories_submitted INTEGER NOT NULL DEFAULT 0,
      directories_live INTEGER DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      paid_at TIMESTAMP,
      delivery_started_at TIMESTAMP,
      completed_at TIMESTAMP,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT dir_orders_submitted_check CHECK (directories_submitted <= directories_allocated)
    );
  ELSE
    RAISE EXCEPTION 'Unsupported users.id type: %. Expected integer, bigint, or uuid.', user_id_type;
  END IF;

  -- Create indexes
  CREATE INDEX IF NOT EXISTS idx_directory_orders_user_id ON directory_orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_directory_orders_status ON directory_orders(status);
  CREATE INDEX IF NOT EXISTS idx_directory_orders_created_at ON directory_orders(created_at);

  RAISE NOTICE 'Created directory_orders table with user_id type: %', user_id_type;
END $$;
