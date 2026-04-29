# Supabase RAG 데이터 적재 가이드 (v1.2.x)

이 문서는 정책/공고 데이터를 정제하여 Gemini 임베딩을 생성하고, Supabase PostgreSQL DB에 적재하는 전체 파이프라인에 대해 설명합니다.

## 1. 개요
통합 정제된 CSV 데이터(`data/csv/main/main_v1_1_6.csv`)를 기반으로, 시멘틱 검색(Semantic Search)이 가능하도록 텍스트를 벡터로 변환하여 Supabase의 `announcements` 테이블에 저장합니다.

`data/csv/main/auto_main_v1_1_6.csv`는 GitHub Actions가 생성하는 최신 자동화 결과이며, Supabase 적재 기준 파일은 사람이 검수한 `main_v1_1_6.csv`입니다.

## 2. 데이터베이스 설정 (Supabase SQL)

데이터 적재 전, Supabase SQL Editor에서 `pgvector` 확장을 활성화하고 아래 테이블 스키마를 생성해야 합니다.

```sql
-- 1. Vector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 통합 공고 테이블 생성
CREATE TABLE announcements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source TEXT NOT NULL,                   -- 사이트 별칭 (youth, kst, biz)
  source_id TEXT NOT NULL,                -- 원본 고유 ID

  -- 공고 내용
  title TEXT,                             -- 공고 제목
  summary TEXT,                           -- 요약 데이터
  provider TEXT,                          -- 제공 기관
  norm_title TEXT,                        -- 정규화된 제목
  norm_provider TEXT,                     -- 정규화된 제공기관
  norm_period TEXT,                       -- 정규화된 일정
  s_category TEXT,                        -- 서비스 표준 카테고리
  region TEXT,                            -- 지역
  target_age_min INT,                     -- 최소 연령. 제한 없음은 NULL
  target_age_max INT,                     -- 최대 연령. 제한 없음은 NULL
  apply_start_dt TIMESTAMP WITH TIME ZONE, -- 신청 시작일
  apply_end_dt TIMESTAMP WITH TIME ZONE,   -- 신청 종료일
  target_group TEXT,                      -- 자격 요건
  detail_url TEXT,                        -- 상세 URL
  _scope TEXT,
  _scope_reason TEXT,

  -- RAG 핵심 데이터
  content TEXT,                           -- 임베딩에 사용된 통합 텍스트
  embedding VECTOR(768),                  -- Gemini-001 (768차원) 벡터 데이터

  -- 메타데이터
  created_dt TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_dt TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- 중복 방지 제약 조건
  CONSTRAINT unique_source_item UNIQUE (source, source_id)
);
```

### 2.1 `announcements` 컬럼 사용성 검토

MVP 검색/RAG/Next.js 표시 기준으로 `announcements` 컬럼은 아래처럼 구분합니다.

| 구분 | 컬럼 | 판단 |
|---|---|---|
| 필수 | `id` | 공고 PK, 스크랩/상세/프론트 key |
| 필수 | `source`, `source_id` | 원본 식별, 중복 방지, upsert 기준 |
| 필수 | `title`, `summary`, `provider` | 검색 결과 카드/상세 화면 표시, 임베딩 텍스트 구성 |
| 필수 | `s_category`, `region` | 서비스 필터, 검색 결과 표시, 임베딩 텍스트 구성 |
| 필수 | `target_age_min`, `target_age_max` | 나이 필터 |
| 필수 | `apply_start_dt`, `apply_end_dt` | 신청 기간 표시, 진행중/마감 상태 계산 |
| 필수 | `target_group`, `detail_url` | 결과 설명/상세 이동 |
| 필수 | `content`, `embedding` | RAG 검색용 통합 텍스트와 Gemini embedding |
| 운영용 | `created_dt`, `updated_dt` | 적재/갱신 추적 |
| 선택 보존 | `norm_title`, `norm_provider`, `norm_period` | 중복 판단/검수 추적용. MVP 검색에는 직접 사용하지 않음 |
| 선택 보존 | `_scope`, `_scope_reason` | main/other 판단 및 검수 근거 추적용. MVP 검색에는 직접 사용하지 않음 |

정리:
- 검색/RAG/Next.js 실행에 꼭 필요한 컬럼은 필수 컬럼입니다.
- `norm_*`, `_scope`, `_scope_reason`은 뒷 로직 필수 컬럼은 아니지만, 데이터 검수와 중복 판단 근거를 남기기 위해 보존할 수 있습니다.
- 효율성이나 스키마 단순화를 우선해 선택 보존 컬럼을 제외하기로 결정하면, `supabase_table_create_query.txt`, 적재 노트북의 upsert whitelist, 관련 문서를 함께 수정해야 합니다.

## 3. 데이터 파이프라인 로직 (`policyRec_v1_2_2.ipynb`)

전체 프로세스는 다음과 같은 단계로 구성됩니다.

### 3.1 데이터 로드 및 텍스트 구성
- `pandas`를 사용하여 정제된 CSV(`data/csv/main/main_v1_1_6.csv`)를 로드합니다.
- 임베딩을 위해 제목, 서비스 카테고리, 지역, 대상, 지원내용, 요약을 결합하여 `combined_text` 또는 `content`를 생성합니다.
- CSV의 `category`는 원 API 카테고리이므로 서비스 필터에는 사용하지 않고, `s_category`를 사용합니다.

### 3.2 텍스트 분할 (Chunking)
- 텍스트가 너무 길 경우(1500자 이상), API 제한 및 검색 효율을 위해 청크 단위로 분할합니다.

### 3.3 Gemini 임베딩 생성
- **모델**: `models/gemini-embedding-001`
- **차원**: Supabase 스키마와 동일한 **768차원**으로 설정합니다.
- **최적화**: API 비용 절감 및 중복 작업 방지를 위해 생성된 데이터를 로컬 JSON 파일로 캐싱합니다.

### 3.4 데이터 정제 및 매핑 (Cleaning & Mapping)
- **결측치 처리**: `NaN`, `확인필요` 등의 비정규 데이터를 `None` (JSON의 null)으로 변환하여 DB 정합성을 유지합니다.
- **CSV 컬럼 매핑**:
  - `title` → `title`
  - `s_category` → `s_category`
  - `apply_start` → `apply_start_dt`
  - `apply_end` → `apply_end_dt`
- **연령 컬럼 처리**: `target_age_min`, `target_age_max`에서 제한 없음은 `0`/`99`가 아니라 `NULL`로 저장합니다.
- **정규화/검수 컬럼 보존**: `norm_title`, `norm_provider`, `norm_period`, `_scope`, `_scope_reason`은 DB 컬럼에 있으므로 적재 가능합니다.
- **적재 제외 컬럼**: `category`, `subcategory`, `combined_text`는 현재 DB 스키마에 없으므로 적재에서 제외합니다.
- **Upsert payload 기준**: CSV 전체 컬럼을 그대로 업로드하지 않고, `announcements` 테이블에 존재하는 컬럼만 화이트리스트로 구성해 적재합니다.


### 3.5 Supabase 적재 (Upsert)
- **전략**: `upsert`를 사용하여 기존 데이터는 업데이트하고 새로운 데이터는 삽입합니다.
- **중복 방지 기준**: `source`, `source_id` 조합을 기준으로 동일 공고의 중복 적재를 방지합니다.
- **안정성**: 네트워크 불안정 및 Rate Limit에 대응하기 위해 재시도(Retry) 및 지수 백오프 로직을 적용합니다.

## 4. 환경 변수 설정 (.env)
적재를 위해 아래 환경 변수가 설정되어 있어야 합니다.
- `GOOGLE_API_KEY`: Gemini API 키
- `SUPABASE_URL`: Supabase 프로젝트 URL
- `SUPABASE_SERVICE_KEY`: Supabase 서비스 롤 키 (직접 적재용)

주의:
- `.env` 파일은 GitHub에 업로드하지 않습니다.
- `SUPABASE_SERVICE_KEY`는 서버/노트북 적재용 키이므로 프론트엔드 클라이언트에 노출하지 않습니다.

## 5. 실행 결과
- 적재 완료 시 시멘틱 검색 기능을 통해 자연어 질의에 가장 적합한 정책 공고를 `embedding` 벡터 연산으로 추출할 수 있습니다.

<br>

# Supabase RAG 데이터 DB 활용 가이드 (v1.2.2)

## 1. policyRec_v1_2_2.ipynb 실행 전 key값 추가 필요

- .env 파일에 키값을 추가 후 antigravity 재실행하면 생성된 db에 접근 가능
> 키값 포함시 github에 업로드되지 않음. 별도로 전달 예정

<br>

## 2. 유사도 검색을 위한 RPC 함수 생성

RAG 시스템의 검색 단계에서 사용되는 하이브리드 벡터 유사도 검색 함수입니다. Supabase SQL Editor에서 실행해야 합니다.

최신 RPC 생성 SQL은 아래 파일을 기준으로 합니다.

```text
Database/RPC_match_announcements_hybrid_v1.sql
```

RPC 이름:
- `match_announcements_hybrid`

주요 기능:
- Gemini embedding 벡터 유사도 검색
- `s_category` 카테고리 필터
- `region` 지역 필터
- `target_age_min`, `target_age_max` 기반 나이 필터
- 특정 지역 선택 시 `전국` 공고도 함께 포함
- UI에서 `전체`가 들어와도 필터 없음으로 처리

주의:
- 기존 단순 RPC인 `match_announcements`를 바로 덮어쓰지 않습니다.
- 새 함수 `match_announcements_hybrid`로 별도 생성합니다.
- 진행중/마감 여부는 RPC에서 계산하지 않고, 반환된 `apply_end_dt`를 기준으로 Next.js/front에서 계산합니다.

```sql
-- 하이브리드 검색 RPC 생성 파일:
-- Database/RPC_match_announcements_hybrid_v1.sql
--
-- 이 문서에는 전체 SQL을 직접 복사하지 않고,
-- 실제 실행 기준 파일만 명시합니다.
-- Supabase SQL Editor에서 해당 파일의 전체 내용을 실행하세요.
```

## 3. RPC 테스트

RPC 생성 후 아래 파일을 Supabase SQL Editor에서 실행하여 데이터와 RPC 동작을 확인합니다.

```text
Database/RPC_test_cases_v1.sql
```

확인 항목:
- `announcements` 전체 적재 건수
- embedding 누락 여부
- `target_age_min`, `target_age_max` NULL 처리 여부
- 카테고리/지역 분포
- 마감일 컬럼 확인
- 나이 필터 조건
- 카테고리 + 지역 필터 조건
- `match_announcements_hybrid` 실제 호출 결과

마감일 확인 기준:
- CSV 원본 날짜에 시간이 없으면 `apply_end_dt`가 `00:00:00`으로 보일 수 있습니다.
- 이 값은 "마감일 시작 시각에 마감"이라는 뜻이 아니라 "마감 날짜"를 timestamp 컬럼에 저장하며 붙은 기본 시간입니다.
- 진행중/마감 여부는 timestamp끼리 비교하지 않고 KST 날짜 기준으로 비교합니다.
- 마감일 당일은 진행중으로 처리합니다.

현재 기준:
- `main_v1_1_6.csv` 기준 적재 건수는 553건입니다.
