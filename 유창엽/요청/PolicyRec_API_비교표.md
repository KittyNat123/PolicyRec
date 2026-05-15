# 3개 공공 API 원천 데이터 비교표

> BizInfo, K-Startup, YouthCenter 3개 API의 원본 컬럼 / 값 형식 차이 정리

---

## 📊 핵심 비교표

### 1. 데이터 구조 차이

| 항목 | BizInfo | K-Startup | YouthCenter |
|------|---------|-----------|-------------|
| **응답 root** | `jsonArray` | `data` | `result.youthPolicyList` |
| **컬럼 수** | 22개 | 30개 | 60개 |
| **명명 규칙** | 한글 약어 (camelCase) | 영문 snake_case | 영문 camelCase 약어 |
| **인코딩** | UTF-8 | UTF-8 | UTF-8 |

### 2. 주요 컬럼 매핑 차이

| 통합 컬럼 | BizInfo | K-Startup | YouthCenter |
|----------|---------|-----------|-------------|
| `title` (제목) | `pblancNm` | `intg_pbanc_biz_nm` | `plcyNm` |
| `source_id` | `pblancId` | `pbanc_sn` | `plcyNo` |
| `summary` (요약) | `bsnsSumryCn` | `pbanc_ctnt` | `plcyExplnCn` + `plcySprtCn` |
| `provider` (기관) | `jrsdInsttNm` / `excInsttNm` | `pbanc_ntrp_nm` / `sprv_inst` | `sprvsnInstCdNm` |
| `target_group` | `trgetNm` | `aply_trgt` | `ptcpPrpTrgtCn` (빈 값 다수) |
| `target_age` | (없음) | `biz_trgt_age` | `sprtTrgtMinAge` / `sprtTrgtMaxAge` |
| `apply_start` | `reqstBeginEndDe` (혼합) | `pbanc_rcpt_bgng_dt` | `bizPrdBgngYmd` |
| `apply_end` | `reqstBeginEndDe` (혼합) | `pbanc_rcpt_end_dt` | `bizPrdEndYmd` |
| `category` | `pldirSportRealmLclasCodeNm` | `supt_biz_clsfc` | `lclsfNm` |
| `region` | (없음, 추론 필요) | `supt_regin` | `zipCd` (행정코드) |
| `detail_url` | `pblancUrl` | `detl_pg_url` | (없음, source_id로 생성) |
| `application_method` | `reqstMthPapersCn` | `aply_mthd_*_istc` (6개 컬럼) | `plcyAplyMthdCn` |

---

### 3. 날짜 형식 차이

| API | 형식 | 실제 예시 |
|-----|------|---------|
| **BizInfo** | 텍스트(혼합) | `"사업별 상이"` / `"2026-04-27 ~ 2026-05-10"` |
| **K-Startup** | 8자리 숫자 | `20260427`, `20260508` |
| **YouthCenter** | 8자리 숫자 | `20260127`, `20261231` |
| **(특수 케이스)** | - | `"상시"`, `"추후공지"`, `"모집완료"` |

→ **통일 형식**: `YYYY-MM-DD` (예: `2026-04-27`)
→ **특수 케이스 처리**: `상시` → `2099-12-31`, `추후공지`/`모집완료` → 문자열 유지

---

### 4. 지역 표현 방식 차이

| API | 표현 방식 | 실제 예시 |
|-----|---------|---------|
| **BizInfo** | 별도 컬럼 없음, `hashtags`에 혼재 | `"기술,서울,부산,대구,인천,..."` |
| **K-Startup** | 한글 시도명 (짧은 형태) | `"전국"`, `"서울"`, `"울산"` |
| **YouthCenter** | 행정표준코드 | `"48170"` (경남 진주시) |
| **(부처명 혼입)** | region에 기관명 들어옴 | `"중소벤처기업부"`, `"제주특별자치도경제통상진흥원 경영본부 청년센터"` |

→ **통일 방식**: `region_rule.csv` 룰표 적용
→ 17개 광역 단위 긴 표기 통일 (예: `서울` → `서울특별시`)
→ 부처명/기관명 → 룰표로 정리

---

### 5. 분야(카테고리) 표현 방식 차이

| API | 컬럼 | 실제 예시 |
|-----|------|---------|
| **BizInfo** | `pldirSportRealmLclasCodeNm` + `pldirSportRealmMlsfcCodeNm` | `"기술"` + `"공동기술개발"` |
| **K-Startup** | `supt_biz_clsfc` | `"멘토링ㆍ컨설팅ㆍ교육"` |
| **YouthCenter** | `lclsfNm` + `mclsfNm` | `"참여･기반"` + `"청년참여"` |

→ **통일 방식**: `cat_rule.csv` 룰표 적용
→ 공통 `s_category` 컬럼 도입 (인력/일자리, 창업, 주거, 자금 등 12개)

---

## 🎯 최종 통합 결과

- **3개 API × 총 112개 원본 컬럼** → **29개 공통 컬럼**으로 통일
- **3개 API raw 600건** → **dedupe 후 main 565건**
- **4종 룰표 도입**: `cat_rule.csv`, `scope_rule.csv`, `region_rule.csv`, `target_tags_rule.csv`

---

## 📌 발표에 쓸만한 한 줄 멘트

> "3개 공공 API가 컬럼명·날짜 형식·지역 표현·분야 분류 체계 모두 달랐기 때문에, 공통 컬럼 매핑 + 4종 룰표(카테고리/스코프/지역/대상태그)로 정규화해 29개 통합 컬럼의 main CSV를 만들었습니다."
