# v1.2.x 임베딩 파이프라인 셋업 가이드

`main_v1_1_6.csv` 기반으로 Supabase + Gemini 임베딩 파이프라인을 연결하기 위한 파일별 변경 명세.

---

## 변경이 필요한 파일 (순서대로 작업)

| 순서 | 파일 | 변경 유형 |
|------|------|----------|
| 1 | Supabase SQL Editor | 테이블 컬럼 수정 + 컬럼 추가 |
| 2 | `supabase_readme.md` | RPC 함수 교체 |
| 3 | `PolicyRec_v1_2_x.ipynb` (신규) | 입력 CSV / 컬럼명 / 텍스트 구성 함수 |

---

## 1. Supabase SQL — `announcements` 테이블

### 1-1. `target_age_min / max` DEFAULT 제거

**변경 이유**: `DEFAULT 0 / DEFAULT 99`는 "나이 제한 없음"과 실제 0세·99세 공고를 구분하지 못한다.
`NULL`이 "제한 없음"을 의미하도록 변경한다.

```sql
ALTER TABLE announcements
  ALTER COLUMN target_age_min DROP DEFAULT,
  ALTER COLUMN target_age_max DROP DEFAULT;
```

이후 검색 쿼리:
```sql
WHERE (target_age_min IS NULL OR target_age_min <= :user_age)
  AND (target_age_max IS NULL OR target_age_max >= :user_age)
```

### 1-2. `target_tags` 컬럼 추가

**변경 이유**: NULL 숫자값은 벡터 공간에서 노이즈다. LLM이 추출한 핵심 키워드를 별도 컬럼으로 임베딩에 투입한다.

```sql
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_tags TEXT;
```

### 1-3. `s_category` 컬럼 추가

**변경 이유**: 기존 `category`는 API 원본값이다. 서비스용 표준 카테고리 `s_category`를 별도 컬럼으로 추가한다.

```sql
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS s_category TEXT;
```

---

## 2. `supabase_readme.md` — RPC 함수 교체

기존 `match_announcements`는 순수 벡터 검색만 한다. 아래 hybrid 버전으로 교체한다.

**기존 함수 삭제:**
```sql
DROP FUNCTION IF EXISTS match_announcements(vector(768), float, int);
```

**신규 함수 생성:**
```sql
CREATE OR REPLACE FUNCTION match_announcements_hybrid (
  query_embedding  vector(768),
  match_threshold  float,
  match_count      int,
  filter_category  text  DEFAULT NULL,
  filter_region    text  DEFAULT NULL,
  user_age         int   DEFAULT NULL
)
RETURNS TABLE (
  id          bigint,
  title       text,
  content     text,
  s_category  text,
  region      text,
  detail_url  text,
  similarity  float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id, a.title, a.content, a.s_category, a.region, a.detail_url,
    1 - (a.embedding <=> query_embedding) AS similarity
  FROM announcements a
  WHERE
    1 - (a.embedding <=> query_embedding) > match_threshold
    AND (filter_category IS NULL OR a.s_category = filter_category)
    AND (filter_region   IS NULL OR a.region      = filter_region)
    AND (user_age IS NULL
         OR (
           (a.target_age_min IS NULL OR a.target_age_min <= user_age)
           AND
           (a.target_age_max IS NULL OR a.target_age_max >= user_age)
         ))
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## 3. `PolicyRec_v1_2_x.ipynb` — 임베딩 노트북 (신규 작성)

기존 `PolicyRec_v1_2_1.ipynb`(v1.1.3 기반)을 참고해서 새로 작성한다.
아래는 기존 코드에서 반드시 바꿔야 할 포인트.

### 3-1. 입력 CSV 경로

```python
# 변경 전 (v1.2.1 기준)
csv_path = "data/clean/combined_normalized_v1_1_3.csv"

# 변경 후
csv_path = "data/csv/main/main_v1_1_6.csv"
```

### 3-2. `combine_features()` 함수

```python
# 변경 전
def combine_features(row):
    return (
        f"제목: {row['title']}\n"
        f"카테고리: {row['category']}\n"   # ← category (구버전)
        f"지역: {row['region']}\n"
        f"대상: {row['target_group']}\n"
        f"요약: {row['summary']}"
    )

# 변경 후
def combine_features(row):
    parts = [
        f"제목: {row['title']}",
        f"카테고리: {row['s_category']}",       # category → s_category
        f"대상: {row['target_group']}",
        # f"태그: {row['target_tags']}",         # Task 2 완료 후 주석 해제
        f"지역: {row['region']}",
        f"지원내용: {row['support_type']}",
        f"요약: {row['summary']}",
    ]
    return "\n".join(p for p in parts if p.split(": ", 1)[1].strip())
```

### 3-3. NULL 처리 — 연령 컬럼

```python
# 기존 처리 (0/99가 DB에 그대로 들어갈 수 있음)
for key, val in data.items():
    if val == '확인필요' or pd.isna(val):
        data[key] = None

# 추가: 연령 0/99 → NULL 명시 처리
for age_col in ('target_age_min', 'target_age_max'):
    if data.get(age_col) in {0, 99}:
        data[age_col] = None
```

> `main_v1_1_6.csv`는 이미 Int64 nullable로 저장되어 있어 `pd.isna()` 처리만으로 대부분 잡힌다.
> 혹시 0/99가 남아 있을 경우를 대비한 안전망 코드다.

### 3-4. Supabase 적재 제외 컬럼

upsert 직전에 아래 컬럼을 `data` dict에서 제거한다.

```python
EXCLUDE_COLS = {
    "_scope", "_scope_reason",
    "norm_title", "norm_provider", "norm_period",
    "category", "subcategory",
    "combined_text",
}
data = {k: v for k, v in data.items() if k not in EXCLUDE_COLS}
```

---

## 변경 후 검증

```sql
-- Supabase SQL Editor에서 확인

-- 1. target_age_min/max NULL 여부
SELECT source_id, target_age_min, target_age_max
FROM announcements
LIMIT 10;

-- 2. s_category 분포
SELECT DISTINCT s_category FROM announcements;

-- 3. content에 s_category 포함 여부
SELECT content FROM announcements LIMIT 1;
```
