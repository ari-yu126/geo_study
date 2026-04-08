-- geo_scoring_config 테이블: GEO 점수 기준 설정을 버전별로 저장
create table if not exists geo_scoring_config (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  config_json jsonb not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- 활성 설정 빠른 조회를 위한 부분 인덱스
create index if not exists idx_geo_scoring_config_active
  on geo_scoring_config (is_active)
  where is_active = true;

-- 한 번에 하나의 active config만 허용하는 트리거
create or replace function ensure_single_active_config()
returns trigger as $$
begin
  if NEW.is_active = true then
    update geo_scoring_config
    set is_active = false
    where id <> NEW.id and is_active = true;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_single_active_config on geo_scoring_config;
create trigger trg_single_active_config
  before insert or update on geo_scoring_config
  for each row
  execute function ensure_single_active_config();
