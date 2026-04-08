-- Latest finalized analysis snapshot per normalized URL (upsert from /api/analyze)

create table if not exists geo_analysis_results (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  normalized_url text not null,
  page_type text not null default 'editorial',
  config_version text,
  geo_score integer,
  score_structure numeric,
  score_answerability numeric,
  score_trust numeric,
  score_citation numeric,
  score_question_coverage numeric,
  result_json jsonb,
  issues_json jsonb,
  passed_checks_json jsonb,
  title text,
  engine_version text,
  status text not null default 'success',
  error_message text,
  source_analysis_id uuid,
  citation_likelihood numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_geo_analysis_results_normalized_url unique (normalized_url)
);

create index if not exists idx_geo_analysis_results_updated
  on geo_analysis_results (updated_at desc);

alter table geo_analysis_results enable row level security;

create policy "anon_all_geo_analysis_results" on geo_analysis_results
  for all to anon using (true) with check (true);
