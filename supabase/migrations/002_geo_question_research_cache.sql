-- Cached Tavily / search-question research per derived topic key (7-day TTL enforced in app)

create table if not exists geo_question_research_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  normalized_url text,
  primary_phrase text not null,
  page_type text,
  questions_json jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_geo_question_research_cache_updated
  on geo_question_research_cache (updated_at desc);

alter table geo_question_research_cache enable row level security;

create policy "anon_all_geo_question_research_cache" on geo_question_research_cache
  for all to anon using (true) with check (true);
