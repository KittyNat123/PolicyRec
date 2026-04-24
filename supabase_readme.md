# Supabase RAG 데이터 적재 가이드 (v1.2.1)

이 문서는 정책/공고 데이터를 정제하여 Gemini 임베딩을 생성하고, Supabase PostgreSQL DB에 적재하는 전체 파이프라인에 대해 설명합니다.

## 1. 개요
통합 정제된 CSV 데이터(`combined_normalized_v1_1_3.csv`)를 기반으로, 시멘틱 검색(Semantic Search)이 가능하도록 텍스트를 벡터로 변환하여 Supabase의 `announcements` 테이블에 저장합니다.

## 2. 데이터베이스 설정 (Supabase SQL)

데이터 적재 전, Supabase SQL Editor에서 `pgvector` 확장을 활성화하고 아래 테이블 스키마를 생성해야 합니다.

```sql
-- 1. Vector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 통합 공고 테이블 생성
CREATE TABLE announcements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source TEXT NOT NULL,                   -- 사이트 별칭 (youth, kst, biz)
  source_id TEXT NOT NULL,                -- 원본 고유 ID
  source_file TEXT,                       -- 원본 JSON 파일 경로
  
  -- 공고 내용
  title TEXT NOT NULL,                    -- 공고 제목
  summary TEXT,                           -- 요약 데이터
  category TEXT,                          -- 분야
  region TEXT,                            -- 지역
  target_group TEXT,                      -- 자격 요건
  target_age_min INT DEFAULT 0,           -- 최소 연령
  target_age_max INT DEFAULT 99,          -- 최대 연령
  start_date TIMESTAMP WITH TIME ZONE,    -- 신청 시작일
  end_date TIMESTAMP WITH TIME ZONE,      -- 신청 종료일  
  detail_url TEXT,                        -- 상세 URL
  provider TEXT,                          -- 제공 기관
  
  -- 메타데이터
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- RAG 핵심 데이터
  content TEXT,                           -- 임베딩에 사용된 통합 텍스트
  embedding vector(768),                  -- Gemini-001 (768차원) 벡터 데이터

  -- 중복 방지 제약 조건
  CONSTRAINT unique_source_announcement UNIQUE (source, source_id)
);
```

## 3. 데이터 파이프라인 로직 (`PolicyRec_v1_2.ipynb`)

전체 프로세스는 다음과 같은 단계로 구성됩니다.

### 3.1 데이터 로드 및 텍스트 구성
- `pandas`를 사용하여 정제된 CSV를 로드합니다.
- 임베딩을 위해 제목, 카테고리, 지역, 대상, 내용을 결합하여 `combined_text`를 생성합니다.

### 3.2 텍스트 분할 (Chunking)
- 텍스트가 너무 길 경우(1500자 이상), API 제한 및 검색 효율을 위해 청크 단위로 분할합니다.

### 3.3 Gemini 임베딩 생성
- **모델**: `models/gemini-embedding-001`
- **차원**: Supabase 스키마와 동일한 **768차원**으로 설정합니다.
- **최적화**: API 비용 절감 및 중복 작업 방지를 위해 생성된 데이터를 `embedded_announcements_v1_2.json` 파일로 로컬 캐싱합니다.

### 3.4 데이터 정제 및 매핑 (Cleaning & Mapping)
- **결측치 처리**: `NaN`, `확인필요` 등의 비정규 데이터를 `None` (JSON의 null)으로 변환하여 DB 정합성을 유지합니다.
- **source_file(원본 경로) 컬럼 매핑**: `source` 값에 따라 원본 소스 파일(`source_file`) 경로를 자동으로 할당합니다.
  - `biz` → `data\raw\biz\...`
  - `kst` → `data\raw\kst\...`
  - `youth` → `data\raw\youthCenter\...`

### 3.5 Supabase 적재 (Upsert)
- **전략**: `upsert`를 사용하여 기존 데이터는 업데이트하고 새로운 데이터는 삽입합니다.
- **안정성**: 네트워크 불안정 및 Rate Limit에 대응하기 위해 **최대 5회의 재시도(Retry)** 및 지수 백오프 로직을 적용하였습니다.

## 4. 환경 변수 설정 (.env)
적재를 위해 아래 환경 변수가 설정되어 있어야 합니다.
- `GOOGLE_API_KEY`: Gemini API 키
- `SUPABASE_URL`: Supabase 프로젝트 URL
- `SUPABASE_SERVICE_KEY`: Supabase 서비스 롤 키 (직접 적재용)

## 5. 실행 결과
- 적재 완료 시 시멘틱 검색 기능을 통해 자연어 질의에 가장 적합한 정책 공고를 `embedding` 벡터 연산으로 추출할 수 있습니다.

<br>

# Supabase RAG 데이터 DB 활용 가이드 (v1.2.2)

## 1. policyRec_v1_2_2.ipynb 실행 전 key값 추가 필요

- .env 파일에 키값을 추가 후 antigravity 재실행하면 생성된 db에 접근 가능 
> 키값 포함시 github에 업로드되지 않음. 별도로 전달 예정

<br>

## 2. 유사도 검색을 위한 RPC 함수 생성

RAG 시스템의 검색 단계에서 사용되는 벡터 유사도 검색 함수입니다. Supabase SQL Editor에서 실행해야 합니다.

```sql
-- 유사도 검색을 위한 RPC 함수 생성
create or replace function match_announcements (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  title text,
  content text,
  category text,
  region text,
  detail_url text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    announcements.id,
    announcements.title,
    announcements.content,
    announcements.category,
    announcements.region,
    announcements.detail_url,
    1 - (announcements.embedding <=> query_embedding) as similarity
  from announcements
  where 1 - (announcements.embedding <=> query_embedding) > match_threshold
  order by announcements.embedding <=> query_embedding
  limit match_count;
end;
$$;
```
