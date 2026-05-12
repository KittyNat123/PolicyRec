CREATE OR REPLACE FUNCTION retrieve_only_announcements (
  query_embedding vector(768),
  match_count int DEFAULT 100
)
RETURNS TABLE (
  id bigint,
  source text,
  source_id text,
  title text,
  summary text,
  provider text,
  s_category text,
  region text,
  target_age_min int,
  target_age_max int,
  apply_start_dt timestamptz,
  apply_end_dt timestamptz,
  target_group text,
  target_tags text[],
  support_type text,
  detail_url text,
  required_documents text,
  application_method text,
  additional_conditions text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.source,
    a.source_id,
    a.title,
    a.summary,
    a.provider,
    a.s_category,
    a.region,
    a.target_age_min,
    a.target_age_max,
    a.apply_start_dt,
    a.apply_end_dt,
    a.target_group,
    a.target_tags,
    a.support_type,
    a.detail_url,
    a.required_documents,
    a.application_method,
    a.additional_conditions,
    1 - (a.embedding <=> query_embedding) AS similarity
  FROM announcements a
  WHERE a.embedding IS NOT NULL
  ORDER BY a.embedding <=> query_embedding, a.id ASC
  LIMIT match_count;
END;
$$;
