# Changelog

PolicyRec — 청년지원사업 통합 추천 AI 프로젝트의 변경 이력.

포맷은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 규칙은 다음과 같습니다.

- `1.1.1`, `1.1.2` — 같은 단계 내 수정사항 반영 (로직 개선, 버그 수정)
- `1.2`, `1.3` — 새 기능 단계 추가 (DB 인덱스, 첨부파일 등)
- `2.0` — 메이저 변경 (스키마 전면 개편, 아키텍처 변경)

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
v1.1.3  : 13컬럼 (스키마 변경 없음, region/category 값 정규화 핫픽스)  ← 현재
```

---

## 🗂️ Backlog (추후 논의사항)

프로토타입 완성 후 논의할 항목들입니다.

| # | 항목 | 핵심 내용 | 이유 |
| :--- | :--- | :--- | :--- |
| 1 | benefit_type 복원 | 데이터 분류 체계(대출, 보조금, 교육 등) 및 자동 분류 알고리즘 구축 | API 항목 없어 별도 작업 필요 |
| 2 | 추후공지 표준화 | `추후공지` 상태 값의 표준 포맷 결정 | 모집완료 시기의 다양한 표현 통일 |
| 3 | 중복 처리 로직 | 공고 중복 식별 기준(ID/Title) 및 source 정보 병합 전략 | 잘못된 중복처리 무결성 문제 |
| 4 | provider 필터링 | provider 기준 필터링시 추가 정규화 | "중소벤처기업부" vs "중소벤처기업부장관" 표기 차이 |
| 5 | biz target_age | 0~99 표기의 한계 해결 | "연령 제한 없음"과 "정보 수집 안 됨" 구별 불가 |
| 6 | Youth target_group 결측 | summary 자연어에서 대상 정보 추출 | API 구조적 한계 / LLM 추출 필요 (v1.4) |
| 7 | Summary 구조화 정보 추출 | `plcySprtCn` 자연어에서 "대상: 18~40세" 등 구조화 | RAG 품질 향상 및 필터 확장 (v1.4) |
| 8 | **category 체계 통일** | **source별로 다른 분류 축을 공통 택소노미로 재편** | **biz=사업분야 / kst=창업단계 / youth=생활영역으로 필터 축이 달라 통합 필터 불가** |

---

## 📋 로드맵

- **v1.2** — SQLite DB + Chroma 임베딩 인덱스 구축
- **v1.3** — 공고 첨부파일(PDF/HWP) 본문 추가, 시군구 단위 매핑
- **v1.4** — Gemma 등 LLM 기반 RAG 추천, summary 자연어 구조화
