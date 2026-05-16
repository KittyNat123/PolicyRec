# Changelog

PolicyRec — 청년지원사업 통합 추천 AI 프로젝트의 변경 이력.

포맷은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 규칙은 다음과 같습니다.

- `1.1.1`, `1.1.2` — 같은 단계 내 수정사항 반영 (로직 개선, 버그 수정)
- `1.2`, `1.3` — 새 기능 단계 추가 (DB 인덱스, 첨부파일 등)
- `2.0` — 메이저 변경 (스키마 전면 개편, 아키텍처 변경)

---

## [Unreleased / MVP 운영] - 2026-05

### Added
- **Next.js 웹 앱** (`web/`) — 검색·추천·챗봇 UI MVP 완료
  - 통합검색 (자연어, Gemini 셀프쿼리 필터 추출)
  - 조건검색 (지역·분야·나이 필터 + condition_score 가중치 정렬)
  - 정렬 (추천순 / 마감순 / 신규순)
  - 스크랩 (저장 / 분야별 조회 / 마감 임박순)
  - AI 맞춤 추천 (프로필 기반 + 스크랩 기반)
  - RAG 챗봇 (대화 맥락 유지, confirm 흐름, 신청 가이드)
  - 관리자 read-only 대시보드 (공고 현황 / 사용자 통계 / 공고 조회)
- **GitHub Actions 자동 수집** (`.github/workflows/weekly_collect.yml`)
  - 매주 수요일 06:00 KST(화 21:00 UTC) 자동 실행
  - BizInfo / K-Startup / YouthCenter API 자동 호출 → 정규화 → main CSV 생성 → git commit
- **Supabase RPC 추가** (`Database/RPC_retrieve_only_announcements.sql`)
  - 메타데이터 필터 없이 의미 유사도 only 검색용 RPC

### Changed
- 챗봇 신청 가이드 보강 — 공고명이 포함된 질문에서 실제 공고 매칭 안정화
- 챗봇 history 로직 — 다른 채팅방 컨텍스트 오염 방지를 위해 history 참조 범위 축소
- 조건검색 추천순 가중치 — 지역 30 / 분야 20 / 나이 10 (대상·상태는 0)
- 통합검색 정렬 보강 — 검색어 있는 마감순/신규순도 서버에서 후보 50개 확보 후 정렬 (로컬 버전)

---

## [1.1.12] - 2026-05-12

### Added
- **region 보정 강화** (v1.1.11 위)
  - 제목의 bracket(예: `[서울]`)과 도시명 기반 region 추가 보정
- 565건 / 29컬럼

### 산출물
- 노트북: `PolicyRec_v1_1_12.ipynb`
- CSV: `data/csv/main/main_v1_1_12.csv` (565건, 29컬럼)

---

## [1.1.11] - 2026-05-08

### Added
- **데이터 품질 보강** (v1.1.10 위)
  - `target_tags_rule` 13개 추가 → 커버리지 100% 달성 (총 46개 룰)
  - `detail_url` 보정: youth NULL → source_id 기반 URL 생성, http 미시작 → `https://` 추가
  - `s_category` 기타 3건 → 올바른 카테고리 재분류

### 산출물
- 노트북: `PolicyRec_v1_1_11.ipynb`
- CSV: `data/csv/main/main_v1_1_11.csv`

---

## [1.1.10] - 2026-05-05

### Changed
- 룰표 파일명 패턴 정리
- `target_tags_rule.csv`, `region_sub_rule.csv` 보강

### 산출물
- 노트북: `PolicyRec_v1_1_10.ipynb`
- CSV: `data/csv/main/main_v1_1_10.csv`

---

## [1.1.9] - 2026-05-03

### Added
- **region 정규화 신규** (v1.1.8 위)
  - `region_rule.csv` 룰표 도입
  - raw 단계에서 부처명/기관명이 region에 혼입되던 문제 해결
    - 예: `중소벤처기업부` 23건, `제주특별자치도경제통상진흥원 경영본부 청년센터` 77건 → 정리
  - 시도 alias 통일 (`서울` → `서울특별시` 등 긴 공식 표기)
- `target_tags` 컬럼 신규 (11종 태그)
  - `target_tags_rule.csv` 룰표 도입

### Changed
- 룰표 파일명 패턴 분리
  - cat/scope 룰표: 노트북 버전 따라감 (`cat_rule_v1_1_X.csv`)
  - region/target_tags 룰표: 단일 파일 (룰 변경 시에만 버전 업)

### 산출물
- 노트북: `PolicyRec_v1_1_9.ipynb`
- CSV: `data/csv/main/main_v1_1_9.csv`

---

## [1.1.8] - 2026-04-30

### Added
- **룰표 v2 적용 + dedupe + 임베딩 준비**
- 새로운 raw 데이터 수집 (`raw_v1_1_8.csv`, 600건)
- 카테고리 룰표 v2 (civic 처리 보강 + 위험 키워드 제거)
- 스코프 룰표 v2 (priority 적용)
- dedupe 자동 처리:
  - URL exact match → `duplicate_url`
  - 제목+기관+기간 100% 일치 → `duplicate_exact`
  - 자매 공고 → review 큐로 분리

### Changed
- v1 대비 v2 룰표 주요 변경점
  - civic 처리: 키워드 8개 → 카테고리 룰 + 보강 키워드 5개
  - 위험 키워드: 경진대회/박람회/페스티벌/서포터즈 → **모두 제거** (창업지원사업 main 유지)
  - 중복 카테고리: youth `참여･기반,참여･기반` 등 자동 처리

### 산출물
- 노트북: `PolicyRec_v1_1_8.ipynb`
- raw CSV: `data/csv/raw/raw_v1_1_8.csv`

---

## [1.2.x] - 2026-04 ~ 2026-05

### Added
- **Supabase 적재 파이프라인** (담당: 김보미)
  - Gemini 임베딩 생성 → Supabase `announcements` 테이블 적재
  - 임베딩 입력 텍스트: title + summary + region + category 등 핵심 필드 결합
- **Hybrid Search RPC** (`Database/RPC_match_announcements_hybrid_v1.sql`)
  - 필터 조건 + 벡터 유사도 결합 검색
- **DB 스키마 정의**
  - `announcements`, `user_info`, `scraps`, `chat_history` 등
  - ERD 문서화 (`Database/ERD_table_info_v1.md`)

---

## [1.1.6] - 2026-04-28

### Added
- `target_age_min` / `target_age_max` 파싱 로직 보강 — 0/99 → NULL 처리 (API 기본값 구분)
- 자동 dedupe 강화: URL exact + 제목 일치 → `duplicate_url`, 제목+기관+기간 100% 일치 → `duplicate_exact` 자동 other 처리
- 자매 공고 분리: dedupe_key 같은데 제목 다른 경우 → review CSV로 별도 출력
- 컬럼 추가: `target_detail`, `additional_conditions`, `required_documents`, `application_method`
- `subcategory` 컬럼 main CSV에 보존 (원본 중분류)

### Changed
- 카테고리 룰표 v2 (`cat_rule_v1_1_6.csv`): civic 처리 보강, 위험 키워드 제거
- 스코프 룰표 v2 (`scope_rule_v1_1_6.csv`): priority 순위 적용
- raw 600건 → dedupe 후 main 554건

### Fixed
- Backlog #3 중복 처리 → 자동 dedupe로 해결
- Backlog #5 biz target_age 0/99 → NULL로 처리하여 "제한 없음" 명확히 구분

### 산출물
- 노트북: `PolicyRec_v1_1_6.ipynb`
- CSV: `data/csv/main/main_v1_1_6.csv` (554건, 28컬럼)
- 룰표: `cat_rule_v1_1_6.csv`, `scope_rule_v1_1_6.csv`

---

## [1.1.5] - 2026-04-xx

### Changed
- `raw_` 접두어 컬럼 전면 제거 → 최종 컬럼명으로 정리
  - `raw_target_group` → `target_group`, `raw_target_age` → `target_age` 등
  - `raw_period_text` 제거 (apply_start / apply_end 분리 사용)
- dedupe 결과: civic_participation 34건 + duplicate_exact 8건 + duplicate_url 4건 → 46건 other 처리
- 600건 → 554건 (v1.1.4 대비 14건 추가 제거)

### 산출물
- 노트북: `PolicyRec_v1_1_5.ipynb`
- CSV: `data/csv/main/main_v1_1_5.csv` (554건, 26컬럼)

---

## [1.1.4] - 2026-04-xx

### Added
- `s_category` 컬럼 — 서비스용 표준 카테고리 (`cat_rule_v1_1_4.csv` 룰표로 매핑)
- `_scope` / `_scope_reason` — 공고 적재 여부 판단 컬럼
- `norm_title` / `norm_provider` / `norm_period` / `norm_detail_url` — dedupe 비교용 정규화 컬럼
- `_dedupe_key` — 제목+기관+기간 합본 중복 탐지 키
- scope_rule CSV 도입 (`scope_rule_v1_1_4.csv`)

### Changed
- 대상 컬럼에 `raw_` 접두어 임시 부여 (v1.1.5에서 제거)
  - `target_group` → `raw_target_group`, `target_age` → `raw_target_age` 등
- `provider`: `supervising_agency` 우선, 없으면 `operating_agency`로 통합
- 600건 → 568건 (dedupe 처리)

### Fixed
- Backlog #8 category 체계 통일 → `s_category` + cat_rule로 source별 분류 통합

### 산출물
- 노트북: `PolicyRec_v1_1_4.ipynb`
- CSV: `data/csv/main/main_v1_1_4.csv` (568건, 25컬럼)

---

## [1.1.3] - 2026-04-23

### Added
- `normalize_region_name()` 함수 — 지역명을 긴 형태로 통일
- `dedupe_category()` 함수 — 쉼표 구분 카테고리 중복 제거 (순서 유지, 가운뎃점 `･`은 보존)
- 6단계 검증에 region 일관성 체크 추가 (짧은 형태 잔존 탐지)
- 6단계 검증에 category 중복 체크 추가

### Fixed
- K-Startup region이 짧은 형태(`서울`, `울산`)로 저장되던 문제 수정 → 긴 형태(`서울특별시`, `울산광역시`)로 통일
- SQL 필터링 시 동일 지역 공고가 source별로 다른 값이라 누락되던 버그 해결
- Youth category에 `"일자리,일자리"`처럼 같은 값이 쉼표 중복으로 들어가던 문제 수정

### Notes
- v1.1 정규화 라인의 **마지막 수정** — 이후 v1.2 (SQLite + Chroma)로 진입
- 원본 API 한계로 해결 불가한 항목들은 Backlog로 이관
- **category 체계 통일은 프로토타입 이후 작업** — 현재 source별로 완전히 다른 분류 축 사용 (Backlog #8 참조)

### 산출물
- 노트북: `PolicyRec_v1_1_3.ipynb`
- CSV: `combined_normalized_v1_1_3.csv`

---

## [1.1.2] - 2026-04-23

### Added
- `clean_html()` 함수 — HTML 태그/엔티티 제거 및 공백 정리
- `finalize_date()` 함수 — 날짜 결측 시 `"확인필요"` 상태값으로 채움
- Youth 연령 컬럼 명시적 매핑 (`sprtTrgtMinAge` / `sprtTrgtMaxAge`)
- 6단계 검증에 HTML 잔존 여부 체크 추가

### Changed
- `summary` 컬럼: title 병합 제거, 원본 요약만 담김
- Youth `summary`: `plcyExplnCn + plcySprtCn` 결합은 유지 (원본 API가 2개 컬럼으로 분할 제공)
- `TBD_KEYWORDS`: "모집완료", "모집완료 시" 추가 → `"추후공지"`로 매핑
- 버전 체계: `v1.1.1 → v1.1.2` 수정 반영 / `v1.2`는 기능 추가
- 노트북/CSV 파일명에 버전 표기 (`PolicyRec_v1_1_2.ipynb`, `combined_normalized_v1_1_2.csv`)

### Removed
- `region_code` 컬럼 (통합 CSV에서만 제거, 원본 추적은 v1.0 raw CSV의 `zipCd`로)

### Deprecated
- `build_summary()` 함수를 주석 처리 (v1.2 Chroma 임베딩 시점에 재활용 예정)

### Known Issues (현재 상태 유지, 문서화만)
- Youth `target_group`: 원본 API가 `ptcpPrpTrgtCn`을 빈 값으로 제공 → NaN 유지
- Biz `target_age`: 원본에 연령 컬럼 없음 → 0~99 기본값 유지
- `provider` 값 표기 차이: "중소벤처기업부장관" vs "중소벤처기업부" 등 → raw 유지

---

## [1.1.1] - 2026-04-22

### Added
- `provider` 컬럼 — 지역명/기관명 혼재 문제 해결을 위해 분리 저장
- `region_code` 컬럼 — Youth zipCd 원본 보존용
- 17개 광역지자체 키워드 기반 `classify_region_or_provider()` 함수
- 행정표준코드 앞 2자리 매핑 (`zipcd_to_region()`)
- `validate_age_range()` — target_age min/max 역전 및 0/0 케이스 보정
- `fix_kst_source_id()` — K-Startup source_id float → int → str 변환

### Changed
- `summary` 컬럼: title과 원본 summary 통합 (⚠️ v1.1.2에서 롤백됨)
- Youth `summary`: `plcyExplnCn + plcySprtCn` 결합
- Youth `region`: 행정코드 → 한글 광역명 매핑
- 날짜 정규화: `상시` → `2099-12-31`, `추후공지` → 문자열 유지

### Removed
- `benefit_type` 컬럼 (3개 source 모두 대응 API 필드 없음, 100% 결측)

---

## [1.1] - 2026-04-21

### Added
- 공통 스키마 정의 (13개 컬럼)
- source별 정규화 함수: `clean_bizinfo()`, `clean_kst()`, `clean_youth()`
- 날짜 형식 통일 로직 (`YYYY-MM-DD`, 8자리 숫자/점/슬래시 처리)
- 연령 파싱 (`parse_kst_age()`, `parse_youth_age()`)
- 결측값 기본값 처리 (region → `전국`, age → `0~99`, category → `기타`)
- 이상값 자동 탐지 검증 셀

### 산출물
- `PolicyRec_v1_1.ipynb`
- `combined_normalized_v1_1.csv`

---

## [1.0] - 2026-04-20

### Added
- 3개 source API 통합 수집 (Bizinfo, K-Startup, Youthcenter)
- 원본 컬럼 전부 보존 (총 116컬럼)
- 출처 메타데이터: `_source`, `_source_name`, `_source_file`, `_source_row_number`

### 산출물
- `combined_raw_columns.csv`

---

## 📌 스키마 변천사

```
v1.0    : 116컬럼 (source별 원본 전부)
v1.1    : 13컬럼 (source, source_id, title, summary, category, benefit_type,
                   region, target_group, target_age_min/max, start_date, end_date, detail_url)
v1.1.1  : 14컬럼 (-benefit_type, +provider, +region_code)
v1.1.2  : 13컬럼 (-region_code)
v1.1.3  : 13컬럼 (스키마 변경 없음, region/category 값 정규화 핫픽스)
v1.1.4  : 25컬럼 — +s_category, +_scope, +norm_*, +_dedupe_key / raw_ 접두어 임시 / 568건
v1.1.5  : 26컬럼 — raw_ 접두어 전면 제거 / 554건
v1.1.6  : 28컬럼 — +target_age_min, +target_age_max (Int64 nullable) / 554건
v1.1.8  : 28컬럼 — 룰표 v2 + dedupe 자동화 / raw 600건
v1.1.9  : 29컬럼 — +target_tags / region_rule.csv 도입
v1.1.10 : 29컬럼 — 룰표 정리
v1.1.11 : 29컬럼 — target_tags 100% 커버리지 / detail_url 보정
v1.1.12 : 29컬럼 / 565건 ← 현재 (region 보정 강화)
```

---

## 🗂️ Backlog (추후 논의사항)

프로토타입 완성 후 논의할 항목들입니다.

| # | 항목 | 핵심 내용 | 이유 |
| :--- | :--- | :--- | :--- |
| 1 | benefit_type 복원 | 데이터 분류 체계(대출, 보조금, 교육 등) 및 자동 분류 알고리즘 구축 | API 항목 없어 별도 작업 필요 |
| 2 | 추후공지 표준화 | `추후공지` 상태 값의 표준 포맷 결정 | 모집완료 시기의 다양한 표현 통일 |
| 3 | ~~중복 처리 로직~~ | ~~공고 중복 식별 기준(ID/Title) 및 source 정보 병합 전략~~ | **v1.1.6 해결** — 자동 dedupe 도입 |
| 4 | provider 필터링 | provider 기준 필터링시 추가 정규화 | "중소벤처기업부" vs "중소벤처기업부장관" 표기 차이 |
| 5 | ~~biz target_age~~ | ~~0~99 표기의 한계 해결~~ | **v1.1.6 해결** — NULL = 제한 없음으로 처리 |
| 6 | Youth target_group 결측 | summary 자연어에서 대상 정보 추출 | API 구조적 한계 / LLM 추출 필요 (v1.4) |
| 7 | Summary 구조화 정보 추출 | `plcySprtCn` 자연어에서 "대상: 18~40세" 등 구조화 | RAG 품질 향상 및 필터 확장 (v1.4) |
| 8 | ~~**category 체계 통일**~~ | ~~**source별로 다른 분류 축을 공통 택소노미로 재편**~~ | **v1.1.4 해결** — `s_category` + cat_rule 룰표로 통합 |
| 9 | api_batch_logs DB 기록 | 자동 수집 yml 끝에 DB INSERT 단계 추가 | 관리자 대시보드 수집 로그 시각화용 |
| 10 | Supabase 자동 적재 | yml에 임베딩 생성 + DB upsert 단계 추가 | 현재는 수동으로 노트북 실행 |
| 11 | 대상 필터 hard filter | 대상 태그를 표준 토큰으로 정규화하여 hard filter 컬럼 추가 | UI 대상 필터 정확도 향상 |
| 12 | 저장 대화 의미 검색 | `chat_history` 임베딩 저장 후 의미 검색 활용 | 챗봇 장기 기억 |

---

## 📋 로드맵

- **현재**: MVP 운영 (검색 + 추천 + 챗봇 + 자동 수집)
- **v1.4** — LLM 기반 `target_tags` 추출 + 추천 이유 자연어 생성
- **v2.0** — 첨부파일 PDF/HWP 본문 RAG 확장
- **Future** — Supabase 자동 적재 파이프라인, 신청 추적, 알림 발송, 사용자 행동 분석
