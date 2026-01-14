-- Phase 2: Add Stripe period columns for usage tracking
-- These columns store the billing period from Stripe webhooks
-- for accurate usage period determination

-- Add stripe_current_period_start if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'stripe_current_period_start'
    ) THEN
        ALTER TABLE users ADD COLUMN stripe_current_period_start TIMESTAMPTZ;
        RAISE NOTICE 'Added stripe_current_period_start column';
    END IF;
END $$;

-- Add stripe_current_period_end if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'stripe_current_period_end'
    ) THEN
        ALTER TABLE users ADD COLUMN stripe_current_period_end TIMESTAMPTZ;
        RAISE NOTICE 'Added stripe_current_period_end column';
    END IF;
END $$;

-- Add stripe_price_id if not exists (for plan resolution from price)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'stripe_price_id'
    ) THEN
        ALTER TABLE users ADD COLUMN stripe_price_id VARCHAR(255);
        RAISE NOTICE 'Added stripe_price_id column';
    END IF;
END $$;

-- Verification
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
    AND column_name IN ('stripe_current_period_start', 'stripe_current_period_end', 'stripe_price_id')
ORDER BY column_name;
