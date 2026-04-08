-- Hosting platform label (URL-based detection; not used for scoring)

alter table geo_analysis_results add column if not exists platform text;

create index if not exists idx_geo_analysis_results_platform
  on geo_analysis_results (platform);
