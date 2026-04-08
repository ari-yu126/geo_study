-- Allow multiple geo_analysis_results rows per normalized_url (one row per successful run)

alter table geo_analysis_results drop constraint if exists uq_geo_analysis_results_normalized_url;

create index if not exists idx_geo_analysis_results_norm_created
  on geo_analysis_results (normalized_url, created_at desc);
