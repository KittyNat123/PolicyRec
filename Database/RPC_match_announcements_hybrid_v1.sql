CREATE OR REPLACE FUNCTION match_announcements_hybrid (
  query_embedding vector(768),
  match_threshold float DEFAULT 0.2,
  match_count int DEFAULT 10,
  filter_category text DEFAULT NULL,
  filter_region text DEFAULT NULL,
  user_age int DEFAULT NULL
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
  detail_url text,
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
    a.detail_url,
    1 - (a.embedding <=> query_embedding) AS similarity
  FROM announcements a
  WHERE
    a.embedding IS NOT NULL

    -- 유사도가 기준값보다 높은 공고만 반환합니다.
    AND 1 - (a.embedding <=> query_embedding) > match_threshold

    -- 카테고리 필터입니다.
    -- NULL 또는 '전체'면 카테고리 필터를 적용하지 않습니다.
    AND (
      filter_category IS NULL
      OR filter_category = '전체'
      OR a.s_category = filter_category
    )

    -- 지역 필터입니다.
    -- NULL 또는 '전체'면 지역 필터를 적용하지 않습니다.
    -- 특정 지역을 고르면 해당 지역 공고와 '전국' 공고를 함께 보여줍니다.
    AND (
      filter_region IS NULL
      OR filter_region = '전체'
      OR a.region = filter_region
      OR a.region = '전국'
    )

    -- 나이 필터입니다.
    -- target_age_min/max가 NULL이면 제한 없음으로 봅니다.
    AND (
      user_age IS NULL
      OR (
        (a.target_age_min IS NULL OR a.target_age_min <= user_age)
        AND
        (a.target_age_max IS NULL OR a.target_age_max >= user_age)
      )
    )
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
