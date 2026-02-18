-- 016_token_balances_transactions.sql
-- Token economy tables: balances and transaction ledger

CREATE TABLE IF NOT EXISTS token_balances (
    id              SERIAL        PRIMARY KEY,
    user_id         INTEGER       NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    monthly_remaining  INTEGER    NOT NULL DEFAULT 0,
    purchased_balance  INTEGER    NOT NULL DEFAULT 0,
    plan_allowance     INTEGER    NOT NULL DEFAULT 0,
    cycle_start_date   TIMESTAMPTZ,
    cycle_end_date     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX idx_token_balances_user_id ON token_balances (user_id);

CREATE TABLE IF NOT EXISTS token_transactions (
    id              SERIAL        PRIMARY KEY,
    user_id         INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(30)   NOT NULL CHECK (type IN (
                        'monthly_grant', 'purchase', 'spend',
                        'monthly_expire', 'purchased_expire'
                    )),
    amount          INTEGER       NOT NULL,
    balance_after   INTEGER       NOT NULL,
    reference_type  VARCHAR(50),
    reference_id    VARCHAR(255),
    created_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX idx_token_transactions_user_id    ON token_transactions (user_id);
CREATE INDEX idx_token_transactions_type       ON token_transactions (type);
CREATE INDEX idx_token_transactions_created_at ON token_transactions (created_at);
