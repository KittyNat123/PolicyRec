# PolicyRec v1.1.6 데이터 구조 참조

작성 기준: `PolicyRec_v1_1_6.ipynb` → `main_v1_1_6.csv` (28컬럼, 553건).

---

## 1. 파이프라인 흐름

```
[API 수집]           [정규화]              [정제]
biz / kst / youth → raw_v1_1_6.csv  →  main_v1_1_6.csv
data/raw/*.json      app/norm.py         PolicyRec_v1_1_6.ipynb
                                         ├─ cat_rule 적용 → s_category
                                         ├─ target_age 파싱 → min/max
                                         ├─ scope_rule 적용 → _scope
                                         └─ dedupe → other 제거
```

### raw → main 변환 단계

| 처리 | 결과 |
| :--- | :--- |
| `cat_rule_v1_1_6.csv` 로드 | `(source, category)` 기준 `s_category` 생성. 중복 카테고리 텍스트 정리 |
| 나이 파싱 | `target_age` 텍스트 → `target_age_min`, `target_age_max` (Int64 nullable) |
| `scope_rule_v1_1_6.csv` 로드 | priority 순으로 `_scope`, `_scope_reason` 부여 |
| 텍스트 정규화 | `norm_title`, `norm_provider`, `norm_period`, `norm_detail_url` 생성 |
| 자동 dedupe | URL 일치 또는 제목+기관+기간 100% 일치 → `_scope = other` 자동 처리 |
| 자매 공고 분리 | dedupe_key 같은데 제목 다름 → review CSV로 분리 (main은 유지) |

---

## 2. 파일 역할

| 단계 | 파일 | 역할 |
| :--- | :--- | :--- |
| API 원본 | `data/raw/{biz\|kst\|youth}/*.json` | 각 API 응답 원본 |
| raw CSV | `data/csv/raw/raw_v1_1_6.csv` | norm.py 정규화 후 600건 전체. `raw_json` 컬럼으로 row-level 원본 추적 가능 |
| category 룰 | `data/csv/rule/cat_rule_v1_1_6.csv` | `(source, raw_category) → s_category` 매핑 |
| scope 룰 | `data/csv/rule/scope_rule_v1_1_6.csv` | main / other 판단 룰 (priority 순) |
| **main CSV** | `data/csv/main/main_v1_1_6.csv` | **임베딩 입력용 최종 CSV** (553건) |
| review CSV | `data/csv/review/review_queue_v1_1_6.csv` | 자매 공고 수동 검토 큐 (해당 건 있을 때만 생성) |

> **`source_file` / `source_row_number` 부재 이유**
> v1.0 노트북에서는 각 row에 `_source_file`(파일 경로), `_source_row_number`(행 번호)를 직접 생성했다.
> v1.1.x에서 norm.py로 리팩토링할 때 이 두 컬럼이 제거되고, 대신 `raw_json`(원본 JSON 전체)을 각 row에 저장하는 방식으로 바뀌었다.

---

## 3. 컬럼 네이밍 규칙

| 접두어 | 의미 | 예시 |
| :--- | :--- | :--- |
| 없음 | 서비스 표시 / 필터 / 임베딩용 핵심 컬럼 | `title`, `s_category` |
| `norm_*` | dedupe 비교용 정규화 값. 사람이 읽는 값 아님 | `norm_title` |
| `_*` | 내부 처리용 / 검수 추적용. DB 스키마에 있는 컬럼은 보존 가능 | `_scope`, `_scope_reason` |

예외:
- `category`는 접두어가 없지만 서비스 표준 카테고리가 아니라 원 API 카테고리이다.
- 서비스 표시/필터/임베딩 기준 카테고리는 `s_category`를 사용한다.
- 현재 DB 적재 기준에서는 `category`를 제외하고, `s_category`만 직접 컬럼으로 적재한다.

---

## 4. 컬럼별 상세

### 식별

| 컬럼 | 타입 | 의미 | 비고 |
| :--- | :--- | :--- | :--- |
| `source` | TEXT | API 출처 (`biz` / `kst` / `youth`) | Supabase PK 구성 요소 |
| `source_id` | TEXT | API 원본 고유 ID | `(source, source_id)` 복합 PK |

### 서비스 핵심

| 컬럼 | 타입 | 의미 | 비고 |
| :--- | :--- | :--- | :--- |
| `title` | TEXT | 공고 제목 | 임베딩 1순위. HTML entity 정리됨 |
| `summary` | TEXT | 요약/본문 | 임베딩 재료. 길이 편차 큼. v1.1.6 기준 일부 HTML 태그 포함 가능 |
| `s_category` | TEXT | 서비스용 표준 카테고리 | `cat_rule_v1_1_6.csv`로 변환. SQL 필터 + 임베딩 양쪽 사용 |
| `provider` | TEXT | 제공 기관 | `supervising_agency` 우선, 없으면 `operating_agency` |
| `region` | TEXT | 지역 | SQL 필터 + 임베딩 양쪽 사용. source별 표현 차이 있음 |

### 대상·조건

| 컬럼 | 타입 | 의미 | 비고 |
| :--- | :--- | :--- | :--- |
| `target_group` | TEXT | 대상자 (청년, 중소기업 등) | SQL 필터 + 임베딩 양쪽 사용 |
| `target_age` | TEXT | 연령 조건 원문 | 예: `만 19세 ~ 만 39세`. 보존용, 검색 미사용 |
| `target_age_min` | Int64 nullable | 연령 하한 (만 나이) | **NULL = 제한 없음**. SQL: `target_age_min <= :user_age` |
| `target_age_max` | Int64 nullable | 연령 상한 (만 나이) | **NULL = 제한 없음**. SQL: `target_age_max >= :user_age` |
| `target_detail` | TEXT | 상세 자격 조건 | youth/kst 전용. sparse |
| `income_condition` | TEXT | 소득 조건 | sparse |
| `startup_stage` | TEXT | 창업 단계 | kst 전용. SQL 필터 + 임베딩 양쪽 사용 |
| `support_type` | TEXT | 지원 형태 (자금/교육/공간 등) | SQL 필터 + 임베딩 양쪽 사용 |

**연령 NULL 처리 규칙**

| 원본 | min | max |
| :--- | :--- | :--- |
| `만 19세 ~ 만 39세` | 19 | 39 |
| `만 0세 ~ 만 0세` | NULL | NULL (API 기본값 0) |
| `만 1세 ~ 만 99세` | NULL | NULL (사실상 제한 없음) |
| 빈 값 | NULL | NULL |

### 신청

| 컬럼 | 타입 | 의미 | 비고 |
| :--- | :--- | :--- | :--- |
| `apply_start` | TEXT (YYYY-MM-DD) | 신청 시작일 | Supabase 적재 시 TIMESTAMPTZ 변환 |
| `apply_end` | TEXT (YYYY-MM-DD) | 신청 종료일 | Supabase 적재 시 `apply_end_dt`. 진행중/마감은 KST 날짜 기준으로 프론트에서 계산 |
| `additional_conditions` | TEXT | 부가 자격 조건 | sparse |
| `required_documents` | TEXT | 제출 서류 | sparse |
| `application_method` | TEXT | 신청 방법 | sparse |
| `detail_url` | TEXT | 공고 상세 URL | 표시용. 임베딩 미사용 |

### 내부 검토

| 컬럼 | 의미 | 값 | 비고 |
| :--- | :--- | :--- | :--- |
| `_scope` | 적재 여부 | `main` / `other` | main CSV에는 `main`만 있음 |
| `_scope_reason` | scope 결정 이유 | `primary` / `civic` / `duplicate_url` / `duplicate_exact` | DB 스키마에 있으므로 검수 추적용으로 보존 가능 |

### 정규화 (dedupe용)

| 컬럼 | 의미 | 비고 |
| :--- | :--- | :--- |
| `norm_title` | 제목 정규화 (공백·특수문자 제거 + 소문자) | DB 스키마에 있으므로 중복 판단/검수 추적용으로 보존 가능 |
| `norm_provider` | 기관명 정규화 | DB 스키마에 있으므로 중복 판단/검수 추적용으로 보존 가능 |
| `norm_period` | `apply_start~apply_end` 합본 정규화 | DB 스키마에 있으므로 중복 판단/검수 추적용으로 보존 가능 |

### 원본 보존

| 컬럼 | 의미 | 비고 |
| :--- | :--- | :--- |
| `category` | API 원본 대분류 | 룰표 재적용 시 재매핑 기준. 서비스 표시는 `s_category` 사용 |
| `subcategory` | API 원본 중분류 | 보존만. 향후 카테고리 세분화 시 재검토 |

---

## 5. 전체 컬럼 한눈에 보기

| 그룹 | 컬럼 | 의미 | 타입 | SQL 필터 | 임베딩 | Supabase 적재 |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| 식별 | `source` | API 출처 (biz/kst/youth) | TEXT | ○ | — | ○ |
| 식별 | `source_id` | API 원본 고유 ID | TEXT | ○ | — | ○ |
| 서비스 핵심 | `title` | 공고 제목 | TEXT | — | ○ | ○ |
| 서비스 핵심 | `summary` | 요약/본문 | TEXT | — | ○ | ○ |
| 서비스 핵심 | `s_category` | 서비스용 표준 카테고리 | TEXT | ○ | ○ | ○ |
| 서비스 핵심 | `provider` | 제공 기관 | TEXT | ○ | ○ | ○ |
| 서비스 핵심 | `region` | 지역 | TEXT | ○ | ○ | ○ |
| 대상·조건 | `target_group` | 대상자 (청년/중소기업 등) | TEXT | ○ | ○ | ○ |
| 대상·조건 | `target_age` | 연령 조건 원문 | TEXT | — | — | ✕ |
| 대상·조건 | `target_age_min` | 연령 하한 (NULL=제한없음) | Int64 nullable | ○ | — | ○ |
| 대상·조건 | `target_age_max` | 연령 상한 (NULL=제한없음) | Int64 nullable | ○ | — | ○ |
| 대상·조건 | `target_detail` | 상세 자격 조건 (youth/kst) | TEXT | — | △ | ✕ |
| 대상·조건 | `income_condition` | 소득 조건 | TEXT | — | △ | ✕ |
| 대상·조건 | `startup_stage` | 창업 단계 (kst 전용) | TEXT | — | ○ | ✕ |
| 대상·조건 | `support_type` | 지원 형태 | TEXT | — | ○ | ✕ |
| 신청 | `apply_start` | 신청 시작일 | TEXT→TIMESTAMPTZ | — | — | ○ (`apply_start_dt`) |
| 신청 | `apply_end` | 신청 종료일 | TEXT→TIMESTAMPTZ | — | — | ○ (`apply_end_dt`) |
| 신청 | `additional_conditions` | 부가 자격 조건 | TEXT | — | △ | ✕ |
| 신청 | `required_documents` | 제출 서류 | TEXT | — | — | ✕ |
| 신청 | `application_method` | 신청 방법 | TEXT | — | — | ✕ |
| 신청 | `detail_url` | 공고 상세 URL | TEXT | — | — | ○ |
| 내부 검토 | `_scope` | 적재 여부 (main/other) | TEXT | — | — | ○ (보존) |
| 내부 검토 | `_scope_reason` | scope 결정 이유 | TEXT | — | — | ○ (보존) |
| 정규화 | `norm_title` | 제목 정규화 (dedupe용) | TEXT | — | — | ○ (보존) |
| 정규화 | `norm_provider` | 기관명 정규화 (dedupe용) | TEXT | — | — | ○ (보존) |
| 정규화 | `norm_period` | 기간 정규화 (dedupe용) | TEXT | — | — | ○ (보존) |
| 원본 보존 | `category` | API 원본 대분류 | TEXT | — | — | ✕ |
| 원본 보존 | `subcategory` | API 원본 중분류 | TEXT | — | — | ✕ |

> △ sparse: 대부분 비어있고 일부만 값이 있는 컬럼. 임베딩 텍스트 구성 시 빈 값이면 제외.
> Supabase 적재는 현재 `announcements` 스키마의 직접 컬럼 기준이다. 직접 컬럼이 없는 값도 `content` 임베딩 텍스트에는 포함할 수 있다.

---

## 6. 임베딩 텍스트 구성

```python
def build_embedding_text(row):
    parts = [
        f"제목: {row['title']}",
        f"카테고리: {row['s_category']}",
        f"대상: {row['target_group']}",
        f"지역: {row['region']}",
        f"지원내용: {row['support_type']}",
        f"요약: {row['summary']}",
    ]
    return "\n".join(p for p in parts if p.split(": ", 1)[1].strip())
```

셀프쿼리(SQL 하드 필터)용 메타데이터: `s_category`, `region`, `target_age_min`, `target_age_max`, `target_group`

진행중/마감 상태는 SQL 하드 필터로 저장하지 않고, `apply_end_dt`를 KST 날짜 기준으로 비교해 Next.js/front에서 계산한다.

---

## 7. 검증 체크포인트

```python
final = pd.read_csv("data/csv/main/main_v1_1_6.csv")

print("컬럼 수:", len(final.columns))       # 28
print("전체 건수:", len(final))              # 553
print("scope 분포:", final["_scope"].value_counts().to_dict())  # {'main': 553}

# 연령 파싱 확인
print("age_min 유효값:", final["target_age_min"].notna().sum())
print("age_max 유효값:", final["target_age_max"].notna().sum())

# 금지 컬럼 유입 확인
forbidden = {"raw_category", "raw_json", "_dedupe_key", "_dup_candidate",
             "supervising_agency", "operating_agency"}
print("금지 컬럼 유입:", sorted(forbidden & set(final.columns)))  # [] 여야 정상
```
