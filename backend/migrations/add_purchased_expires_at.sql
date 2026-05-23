-- add_purchased_expires_at.sql
-- Adds a 12-month rolling expiry timestamp for purchased tokens.
-- NULL = no purchased tokens (or legacy row predating this column).
-- The clock resets on every new purchase (see TokenService.creditPurchasedTokens).
-- A daily cron sweeps rows where purchased_expires_at < NOW() and zeros the balance.

ALTER TABLE token_balances
  ADD COLUMN IF NOT EXISTS purchased_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_token_balances_purchased_expires_at
  ON token_balances (purchased_expires_at)
  WHERE purchased_expires_at IS NOT NULL;
