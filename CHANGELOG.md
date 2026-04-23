# CHANGELOG — PolicyRec

청년지원사업 통합 추천 AI 프로젝트의 버전 변경 이력입니다.

## 버전 표기 규칙

- **v1.1.1, v1.1.2, v1.1.3**: 같은 단계 내 수정사항 반영 (정규화 로직 개선 등)
- **v1.2, v1.3**: 새 기능 단계 추가 (DB 인덱스, 첨부파일 등)
- **v2.0**: 메이저 변경 (스키마 전면 개편, 아키텍처 변경 등)

---

## [v1.1.2] - 예정

### 🔧 코드 변경 (8개)

| # | 항목 | 상세 개선 로직 |
| :--- | :--- | :--- |
| 1 | HTML 태그 제거 | summary에 섞인 `<p>`, `&nbsp;`, `&amp;` 등 HTML 태그/엔티티 제거 (`re.sub` + `html.unescape` + 공백 정리) |
| 2 | 날짜 결측 처리 | `normalize_date` 결과가 None일 때 `"확인필요"` 상태값으로 채움 (`finalize_date` 함수 추가) |
| 3 | 모집완료 키워드 매핑 | "모집완료 시", "모집완료" 등 키워드를 `TBD_KEYWORDS`에 추가하여 `"추후공지"`로 매핑 |
| 4 | region_code 컬럼 제거 | 통합 CSV에서 region_code 삭제, 원본 추적은 v1.0 raw CSV의 `zipCd`로 대체 (컬럼 14→13) |
| 5 | 컬럼 통합 원복 | summary = 원본 요약만 (title 병합 제거). Youth는 `plcyExplnCn + plcySprtCn` 결합 유지 |
| 6 | build_summary 보존 | 함수 삭제 않고 주석 처리하여 v1.2 Chroma 임베딩 시점에 재활용 |
| 7 | Youth 연령 컬럼 명시화 | `sprtTrgtMinAge` / `sprtTrgtMaxAge` 명시적 매핑 추가 (자동탐색은 폴백으로 유지) |
| 8 | 버전 표기 체계 개편 | 수정 반영시 `v1.1.1 → v1.1.2`, 기능 추가시 `v1.2`로 구분. 노트북/CSV 파일명 일치 |

### 📝 현재 상태 유지 + 문서화 (3개)

| # | 항목 | 내용 |
| :--- | :--- | :--- |
| 9 | Youth `target_group` | 원본 API가 `ptcpPrpTrgtCn` 필드를 빈 값으로 제공하여 100% 결측 (v1.0 CSV 확인). NaN 유지 |
| 10 | Biz `target_age` | 원본에 연령 컬럼 없음. 0~99 기본값 유지 (프로토타입 범위) |
| 11 | Provider 값 정규화 | "중소벤처기업부장관" 등 표기 차이 존재. raw 표기 그대로 유지 (프로토타입 범위) |

### 📦 산출물
- 노트북: `PolicyRec_v1_1_2.ipynb`
- CSV: `combined_normalized_v1_1_2.csv`

---

## [v1.1.1]

### 🔧 코드 변경 (8개)

| # | 항목 | 상세 개선 로직 |
| :--- | :--- | :--- |
| 1 | 지역 코드 변환 | youth 데이터의 행정코드를 실제 지자체 한글 명칭으로 매핑 (Replace/Rename) |
| 2 | 연령 유효성 검사 | target_min, target_max 역전 시 Swap 로직 적용 (데이터 무결성 확보) |
| 3 | 날짜 정규화 | `상시` → `2099-12-31` 변환 / `추후공지` → 문자열 유지 |
| 4 | benefit_type 관리 | 미분류 컬럼 우선 삭제 후, 데이터 정제 파이프라인 정리 |
| 5 | 컬럼 통합 | title과 summary를 summary 단일 컬럼 하나로 통합 운영 |
| 6 | RAG 맥락 강화 | youth 데이터 summary에 `plcyExplnCn + plcySprtCn` 내용 결합 |
| 7 | KST 데이터 수정 | source_id 값에서 불필요한 소수점 제거 (정수 타입 강제 변환) |
| 8 | provider 추가 | 지역명/기관명 혼재 문제 해결. 17개 광역지자체 키워드로 판별 후 region과 provider 컬럼으로 분리 저장 (지역명→region / 부처·기관명→provider) |

### 📦 산출물
- 노트북: `PolicyRec_v1_1.ipynb` (업데이트판)
- CSV: `combined_normalized_v1_1.csv`

---

## [v1.1]

### 🎯 목표
공통 컬럼 정규화 기준 정의 및 파이프라인 초안 작성

### 🔧 주요 작업
- 공통 스키마 13개 컬럼 정의 (v1.1.1에서 region_code/provider 추가, v1.1.2에서 region_code 제거)
- source별 정규화 함수 분리: `clean_bizinfo()`, `clean_kst()`, `clean_youth()`
- 날짜 형식 `YYYY-MM-DD` 통일 (8자리 숫자, 점·슬래시 구분자, Bizinfo 범위값 처리)
- 연령 파싱 및 `target_age_min` / `target_age_max` 분리
- 결측값 기본값 처리 (region → `전국`, age → `0~99`, category → `기타`)
- 이상값 자동 탐지 검증 셀

---

## [v1.0]

### 🎯 목표
API 원본 보존 및 출처 추적

### 🔧 주요 작업
- 3개 source (Bizinfo, K-Startup, Youthcenter) API 통합
- 원본 컬럼 전부 보존 (총 116컬럼)
- `_source`, `_source_name`, `_source_file`, `_source_row_number` 메타데이터 추가

### 📦 산출물
- CSV: `combined_raw_columns.csv`

---

## 🗂️ 추후 논의사항 (Backlog)

프로토타입 완성 후 논의할 항목들입니다. v1.1.2 기준으로 7개가 쌓여있습니다.

| 순번 | 항목 | 논의 핵심 내용 | 이유 |
| :--- | :--- | :--- | :--- |
| 1 | benefit_type 복원 | 데이터 분류 체계(대출, 보조금, 교육 등) 및 자동 분류 알고리즘 구축 | benefit_type에 해당하는 API 항목이 없어서 별도 작업 필요 |
| 2 | 추후공지 표준화 | 데이터 활용 목적에 따른 `추후공지` 상태 값의 표준 포맷 결정 | 다양한 형태의 모집완료 시기를 어떻게 표현할지 논의 |
| 3 | 중복 처리 로직 | 공고 중복 식별 기준(ID/Title 등) 정립 및 source 정보 병합 전략 | 잘못된 중복처리 무결성 문제 |
| 4 | provider 필터링 | 필터링 단계에서 발생하는 정규화 문제 해결 | provider 기준 필터링시 추가 정규화 필요 ("중소벤처기업부" vs "중소벤처기업부장관") |
| 5 | biz source target_age | 필터링 단계에서 발생하는 문제 해결 | 0~99 로 표기시 "연령 제한 없음"과 "정보 수집 안 됨"이 구별되지 않음 |
| 6 | Youth target_group 결측 | 원본 `ptcpPrpTrgtCn` 필드가 비어있어 대상 정보 부재. summary 자연어에서 추출 필요 | API 구조적 한계 / LLM 기반 추출 필요 (v1.4) |
| 7 | Summary 내 구조화 정보 추출 | `plcySprtCn`에 "대상: 18세 이상~40세" 같은 구조화 가능한 정보가 자연어로 섞여 있음 | RAG 품질 향상 및 필터링 확장을 위해 필요 (v1.4) |

---

## 📋 다음 단계 계획

### v1.2 (예정) — SQLite + Chroma 인덱스 구축
1. `combined_normalized_v1_1_2.csv`를 입력으로 사용
2. **SQLite DB** 생성: 구조화된 필터링 (지역, 연령, 카테고리, 날짜)
3. **Chroma 컬렉션** 생성: `build_summary()`로 title + summary + category 동적 결합 후 임베딩
4. 두 저장소를 `source_id`로 연결

### v1.3 (예정) — 첨부파일 본문 추가
- 공고 PDF/HWP 첨부파일 본문 추출 및 Chroma에 추가
- Youth 시군구 단위 매핑표 추가 (현재는 광역까지만)
- Provider 정규화 단계 추가 (추후 논의사항 #4)

### v1.4 (예정) — LLM 기반 RAG
- Gemma 등 LLM 연동
- summary 자연어에서 structured data 추출 (추후 논의사항 #6, #7)
- 사용자 맞춤 추천 로직

---

## 📌 스키마 변천사

```
v1.0  : 원본 116컬럼 (source별 전부 보존)
v1.1  : 공통 13컬럼 (source, source_id, title, summary, category, benefit_type,
        region, target_group, target_age_min, target_age_max,
        start_date, end_date, detail_url)
v1.1.1: 공통 14컬럼 (-benefit_type, +provider, +region_code)
v1.1.2: 공통 13컬럼 (-region_code)  ← 현재
```
