-- 1. 전체 적재 건수 확인
SELECT COUNT(*) AS total_count
FROM announcements;

-- 기대: 553
-- 기준: data/csv/main/main_v1_1_6.csv, 2026-04-29 현재


-- 2. embedding 누락 확인
SELECT COUNT(*) AS missing_embedding_count
FROM announcements
WHERE embedding IS NULL;

-- 기대: 0

-- 3. 나이 제한 NULL 처리 확인
SELECT
  COUNT(*) FILTER (WHERE target_age_min IS NULL) AS min_null_count,
  COUNT(*) FILTER (WHERE target_age_max IS NULL) AS max_null_count,
  COUNT(*) FILTER (WHERE target_age_min = 0) AS min_zero_count,
  COUNT(*) FILTER (WHERE target_age_max = 99) AS max_99_count
FROM announcements;

-- min_zero_count, max_99_count가 많으면 0/99 기본값으로 잘못 적재된 가능성이 있음

-- 4. 카테고리 분포 확인
SELECT s_category, COUNT(*) AS count
FROM announcements
GROUP BY s_category
ORDER BY count DESC;

-- 현재 기준: 창업지원이 아니고 창업
SELECT COUNT(*) AS startup_category_count
FROM announcements
WHERE s_category = '창업';

-- 기대: 1건 이상

-- 5. 지역 분포 확인
SELECT region, COUNT(*) AS count
FROM announcements
GROUP BY region
ORDER BY count DESC;

-- 6. 마감일 컬럼 확인
SELECT title, apply_start_dt, apply_end_dt
FROM announcements
ORDER BY apply_end_dt NULLS LAST
LIMIT 20;

-- 마감일 데이터 품질 확인
SELECT
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE apply_start_dt IS NULL) AS missing_apply_start_count,
  COUNT(*) FILTER (WHERE apply_end_dt IS NULL) AS missing_apply_end_count,
  COUNT(*) FILTER (
    WHERE apply_start_dt IS NOT NULL
      AND apply_end_dt IS NOT NULL
      AND apply_start_dt > apply_end_dt
  ) AS invalid_period_count
FROM announcements;

-- 확인 기준:
-- 1) apply_end_dt가 대부분 채워져 있는지 확인한다.
-- 2) apply_end_dt가 NULL인 건은 상시/확인필요 공고인지 별도 확인한다.
-- 3) invalid_period_count는 0이어야 한다.

-- 마감일 KST 날짜 비교 확인
-- CSV 원본 날짜에 시간이 없으면 apply_end_dt가 00:00:00으로 보일 수 있다.
-- 이 값은 "마감일 시작 시각에 마감"이 아니라 "마감 날짜"로 해석한다.
-- 진행중/마감 판단은 timestamp가 아니라 KST 날짜끼리 비교한다.
SELECT
  title,
  apply_end_dt,
  (apply_end_dt AT TIME ZONE 'Asia/Seoul')::date AS apply_end_kst_date,
  (NOW() AT TIME ZONE 'Asia/Seoul')::date AS today_kst_date,
  CASE
    WHEN apply_end_dt IS NULL THEN '상시/확인필요'
    WHEN (apply_end_dt AT TIME ZONE 'Asia/Seoul')::date
      >= (NOW() AT TIME ZONE 'Asia/Seoul')::date THEN '진행중'
    ELSE '마감'
  END AS status_by_kst_date
FROM announcements
ORDER BY apply_end_dt NULLS LAST
LIMIT 20;

-- 7. 나이 필터 조건 구조 확인
SELECT title, target_age_min, target_age_max
FROM announcements
WHERE
  (target_age_min IS NULL OR target_age_min <= 25)
  AND
  (target_age_max IS NULL OR target_age_max >= 25)
LIMIT 20;

-- 8. 카테고리 + 지역 필터 구조 확인
SELECT title, s_category, region
FROM announcements
WHERE
  s_category = '창업'
  AND (region = '서울' OR region = '전국')
LIMIT 20;

-- 9. 실제 RPC 호출 테스트는 query_embedding 준비 후 실행
-- SELECT *
-- FROM match_announcements_hybrid(
--   '[0.01, 0.02, ...]'::vector(768),
--   0.2,
--   10,
--   '창업',
--   '서울',
--   25
-- );

-- 10. Gemini API 없이 RPC 동작 확인
-- 이미 DB에 저장된 embedding 하나를 query_embedding처럼 사용한다.
-- 결과가 1개 이상 나오면 RPC 함수 자체는 정상이다.

WITH q AS (
  SELECT embedding
  FROM announcements
  WHERE embedding IS NOT NULL
  LIMIT 1
)
SELECT *
FROM match_announcements_hybrid(
  (SELECT embedding FROM q),
  0.0,
  5,
  NULL,
  NULL,
  NULL
);

-- 11. 지역 필터가 전국 공고를 함께 포함하는지 확인
-- 서울 필터를 걸었을 때 region='서울' 또는 region='전국' 결과가 나와야 한다.

WITH q AS (
  SELECT embedding
  FROM announcements
  WHERE embedding IS NOT NULL
  LIMIT 1
)
SELECT title, region, similarity
FROM match_announcements_hybrid(
  (SELECT embedding FROM q),
  0.0,
  20,
  NULL,
  '서울',
  NULL
)
WHERE region IN ('서울', '전국');
