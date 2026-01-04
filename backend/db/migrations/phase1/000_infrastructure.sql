-- Migration 000: Infrastructure (extensions + helpers)

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  RAISE NOTICE 'pgcrypto extension enabled';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Could not create pgcrypto extension (insufficient privileges). Using fallback token generator.';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    EXECUTE $ddl$
      CREATE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $func$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql;
    $ddl$;
    RAISE NOTICE 'Created update_updated_at_column function';
  ELSE
    RAISE NOTICE 'update_updated_at_column already exists, skipping';
  END IF;
END $$;
