-- Migration: create reference_sources table
-- Purpose: store research sources (tavily/perplexity/manual) linked to config versions

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.reference_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  url text UNIQUE,
  snippet text,
  source_type text,       -- 'paper', 'industry', 'docs', 'blog'
  provider text,          -- 'official' | 'academic' | 'industry' | 'tavily' | 'manual' | 'perplexity'
  authority_level text,   -- 'high' | 'medium' | 'low'
  fetched_at timestamptz DEFAULT now(),
  config_version text
);

CREATE INDEX IF NOT EXISTS idx_reference_sources_config_version ON public.reference_sources(config_version);
CREATE INDEX IF NOT EXISTS idx_reference_sources_provider ON public.reference_sources(provider);

