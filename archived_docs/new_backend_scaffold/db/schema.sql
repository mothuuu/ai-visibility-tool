-- ---------------------------------------------
-- AOME Core Database Schema
-- ---------------------------------------------

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  plan TEXT DEFAULT 'freemium',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DOMAINS
CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  vertical TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ANALYSES
CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID REFERENCES domains(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  summary JSONB,
  score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PAGES
CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  content_length INT,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RECOMMENDATIONS
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
  category TEXT,
  severity TEXT,
  recommendation JSONB,
  faq_refs TEXT[],
  evidence JSONB,
  validation_status TEXT DEFAULT 'pending'
);

-- SUBSCRIPTIONS (plan tracking)
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  plan TEXT DEFAULT 'starter',
  page_quota INT DEFAULT 5,
  used_pages INT DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FAQ LIBRARY
CREATE TABLE IF NOT EXISTS faq_library (
  id TEXT PRIMARY KEY,
  vertical TEXT DEFAULT 'default',
  question TEXT,
  answer_human_friendly JSONB,
  answer_factual_backend JSONB,
  answer_fallback JSONB,
  schema_jsonld JSONB,
  related_categories TEXT[],
  extraction_rules JSONB,
  priority TEXT DEFAULT 'medium'
);

-- RECOMMENDATION TEMPLATES
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  vertical TEXT,
  version INT DEFAULT 1,
  category TEXT,
  body_md TEXT,
  variables_schema JSONB,
  flags JSONB
);
