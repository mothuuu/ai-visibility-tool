# Run Database Migration for Historic Comparison Feature

## Problem
Scans are failing with 500 error because the `domain` column doesn't exist in the production database.

## Solution
Run the migration script to add the required columns.

## Steps to Run Migration

### Option 1: Using Render Shell (Recommended)
1. Go to your Render Dashboard
2. Click on your web service
3. Go to "Shell" tab
4. Run:
   ```bash
   cd backend/db
   node migrate-historic-comparison.js
   ```

### Option 2: Using PostgreSQL Client Locally
1. Make sure you have PostgreSQL client installed
2. Export `DATABASE_URL` from your secret manager / environment (never hardcode it):
   ```bash
   # Example placeholder — replace with the value sourced from your secret manager
   export DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<db>?sslmode=require"
   cd backend/db
   node migrate-historic-comparison.js
   ```

   Or, using a one-off shell that reads the URL from your environment:
   ```bash
   cd backend/db
   DATABASE_URL="${DATABASE_URL:?set DATABASE_URL via your secret manager before running}" \
     node migrate-historic-comparison.js
   ```

> ⚠️ **Never commit a real connection string.** See the “Secure Setup” section below.

### Option 3: Manual SQL (if above don't work)
Connect to your database and run:
```sql
-- Add domain column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='scans' AND column_name='domain'
  ) THEN
    ALTER TABLE scans ADD COLUMN domain VARCHAR(255);
    CREATE INDEX idx_scans_domain ON scans(user_id, domain, created_at DESC);
  END IF;
END $$;

-- Add previous_scan_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='scans' AND column_name='previous_scan_id'
  ) THEN
    ALTER TABLE scans ADD COLUMN previous_scan_id INTEGER REFERENCES scans(id);
    CREATE INDEX idx_scans_previous ON scans(previous_scan_id);
  END IF;
END $$;

-- Add comparison_data column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='scans' AND column_name='comparison_data'
  ) THEN
    ALTER TABLE scans ADD COLUMN comparison_data JSONB;
  END IF;
END $$;

-- Backfill domain for existing scans
UPDATE scans
SET domain = CASE
  WHEN url ~ '^https?://([^/]+)' THEN
    regexp_replace(
      regexp_replace(
        substring(url from '^https?://([^/]+)'),
        '^www\.', ''
      ),
      ':\d+$', ''
    )
  ELSE NULL
END
WHERE domain IS NULL AND url IS NOT NULL;
```

## Expected Output
```
🔄 Starting historic comparison migration...
  📝 Adding domain column to scans table...
  🔗 Adding previous_scan_id column to scans table...
  📊 Adding comparison_data column to scans table...
  🔄 Backfilling domain for existing scans...
  ✅ Backfilled domain for X scans
✅ Historic comparison migration completed successfully!
🎉 Migration complete!
```

## What This Migration Does
1. Adds `domain` column to store extracted root domain (e.g., "visible2ai.com")
2. Adds `previous_scan_id` column to link scans together
3. Adds `comparison_data` column to store comparison results
4. Backfills `domain` for all existing scans by extracting from URLs
5. Creates indexes for performance

## After Migration
Once the migration completes, your scans should work immediately without any code changes.

## Secure Setup: Sourcing `DATABASE_URL`

Never paste real database credentials into source files, docs, or chat logs.
Use one of the following approaches and rotate the credential immediately if it
is ever exposed.

### Local development
1. Copy `.env.example` to `.env` (already gitignored).
2. Set `DATABASE_URL` to your **local** Postgres instance only.
3. Source the file before running scripts (`set -a; . ./.env; set +a`) or use
   `dotenv` / your shell's env loader.

### Production (Render / AWS / GCP / Azure / Fly / Heroku / Vercel)
- Store `DATABASE_URL` as a managed environment variable / secret:
  - **Render:** Service → *Environment* → add `DATABASE_URL`.
  - **AWS:** Secrets Manager or SSM Parameter Store; inject via task definition.
  - **GCP:** Secret Manager; mount as env var on Cloud Run / GKE.
  - **Azure:** Key Vault; reference from App Service config.
  - **Fly.io:** `fly secrets set DATABASE_URL=...`.
  - **Vercel:** Project → *Settings* → *Environment Variables*.
- The application reads `process.env.DATABASE_URL` — no value is hardcoded.
- Restrict who can read production secrets (least privilege).
- Rotate credentials on a schedule and immediately on any suspected exposure.

See [SECURITY.md](./SECURITY.md) for the secret-handling policy and the
remediation checklist used when a credential is leaked.
