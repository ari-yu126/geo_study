-- =============================================
-- GEO Analyzer: Supabase 마이그레이션
-- =============================================

-- 1) 기존 analysis_history 테이블 재구성
--    (기존 컬럼이 코드와 안 맞으므로 드롭 후 재생성)
DROP TABLE IF EXISTS analysis_history;

CREATE TABLE analysis_history (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  url           text NOT NULL,
  normalized_url text NOT NULL UNIQUE,
  geo_score     integer DEFAULT 0,
  question_coverage numeric DEFAULT 0,
  result_json   jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_analysis_history_normalized_url ON analysis_history (normalized_url);
CREATE INDEX idx_analysis_history_updated_at ON analysis_history (updated_at DESC);

-- RLS 활성화 + anon 허용
ALTER TABLE analysis_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_analysis_history" ON analysis_history
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- 2) geo_scoring_config 테이블 생성
DROP TABLE IF EXISTS geo_scoring_config;

CREATE TABLE geo_scoring_config (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  version     text NOT NULL,
  config_json jsonb NOT NULL,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_geo_scoring_config_active ON geo_scoring_config (is_active, created_at DESC);

-- RLS 활성화 + anon 허용
ALTER TABLE geo_scoring_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_geo_scoring_config" ON geo_scoring_config
  FOR ALL TO anon USING (true) WITH CHECK (true);
