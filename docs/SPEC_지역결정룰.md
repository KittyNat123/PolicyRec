# SPEC: 지역(region) 결정 룰

> **목적**: CSV → DB 적재 전 정제 단계에서 announcement의 `region` 컬럼을 결정하는 마스터 로직 사양.
>
> **배경**: 기존 `region_rule.csv`의 `exact`/`prefix` 위주 매칭은 (a) 광역시명이 기관명 안에 묻혀 있는 케이스(예: "대구콘텐츠기업지원센터")와 (b) 시·군 단위로만 표기된 케이스(예: "완도군청년창업")를 잡지 못해 다수의 정책이 `region="전국"` fallback으로 흘러갑니다. 이는 광역 필터에서 무관한 지역 정책이 함께 노출되는 회귀를 유발합니다. 본 사양은 **6단계 정수 우선순위 체계**로 이를 해결합니다.
>
> **담당**: 정제 코드(노트북) — 창엽 / DB 적재·검증 — 보미 / 웹앱 검증 — 희민
>
> **관련 파일**:
> - `data/csv/rule/region_rule.csv` — 기존 룰 (1~3단계 그대로 사용, 유지)
> - `PolicyRec_v1_1_11.ipynb` — region 결정 함수 위치 (창엽 작업 대상)
> - `web/app/api/search/route.ts` — DB의 region을 그대로 사용 (수정 없음)

---

## 1. 6단계 우선순위 체계 (마스터)

| 순위 | 단계 | 룰 소스 | 동작 |
|------|------|---------|------|
| 1 | `title_bracket` | `region_rule.csv` (R00_xx) | 제목의 `[서울]`, `[대구·경북]` 같은 명시 prefix → 최우선 매핑 |
| 2 | `exact` | `region_rule.csv` (R20~R55) | 부처/공공기관명 정확 일치 → `전국` 즉시 결정 |
| 3 | `prefix` | `region_rule.csv` (R30~R51) | provider가 시·도명으로 시작 (예: "전라남도청 ○○") |
| 4 | **`contains_broad`** ★ | 코드 상수 `REGION_BROAD_KEYWORDS` | `title + provider`에 광역시·도 키워드 포함 검사 |
| 5 | **`contains_sub`** ★ | 코드 상수 `REGION_SUB_KEYWORDS` | 광역 매칭 실패 시, 시·군 키워드 검사 → 상위 광역으로 매핑 |
| 6 | `fallback` | — | 위 모두 실패 시 `region = "전국"` |

**핵심 변경점**: 4단계와 5단계가 신규. 1·2·3·6단계는 기존 동작 그대로 유지하므로 회귀 위험 없음.

**검사 텍스트 통일 규칙**: 4·5단계 모두 기본은 `title + provider`. summary 포함 여부는 §3.2 확장안 참고.

---

## 2. 4단계 — `contains_broad` (광역시·도 키워드)

### 2.1 키워드 사전 (17개)

```python
REGION_BROAD_KEYWORDS = {
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "대전": "대전광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "경기": "경기도",
    "강원": "강원특별자치도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전북": "전북특별자치도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
}
```

### 2.2 매칭 알고리즘

```python
import re

def detect_broad_region(title: str, provider: str | None) -> str | None:
    text = f"{title or ''} {provider or ''}"
    if not text.strip():
        return None
    matches = []
    for kw, region in REGION_BROAD_KEYWORDS.items():
        # 단어 경계 패턴 권장 (오탐 방어). 단순 in 검사도 대안 가능.
        for m in re.finditer(re.escape(kw), text):
            matches.append((m.start(), kw, region))
    if not matches:
        return None
    matches.sort(key=lambda x: x[0])  # 가장 먼저 등장한 키워드 채택
    return matches[0][2]
```

### 2.3 채택 기준

- 여러 광역 키워드가 동시 등장하면 **가장 먼저 등장한 것**을 선택
- 1단계(`title_bracket`)가 `[대구·경북]` 같은 다중 표기를 이미 처리하므로, 4단계까지 내려온 다중 표기는 단일 매핑으로 처리해도 무방

### 2.4 핵심 효과 — 대구 공공기관 사례 해결

| 사례 | 변경 전 | 변경 후 |
|------|---------|---------|
| `"대구콘텐츠기업지원센터"` (region="전국" 오분류) | 충남 필터에 함께 노출 ❌ | 4단계에서 `대구광역시`로 정확 매핑 → 충남 필터에 더 이상 노출되지 않음 ✅ |
| `"부산창조경제혁신센터"` | 동일 문제 | 4단계에서 `부산광역시`로 자동 해결 ✅ |

→ "광역 필터에 무관한 지역 정책이 끼어드는 회귀"의 1차 원인 제거.

---

## 3. 5단계 — `contains_sub` (시·군 키워드)

### 3.1 키워드 사전 (시·군 → 상위 광역 역매핑)

광역 사전(17개)으로 잡히지 않는 케이스를 위해, 시·군 단위 키워드 사전을 신규 도입합니다.

**구성 권장 방안**:
- **별도 CSV로 분리** — `data/csv/rule/region_sub_rule.csv` (`keyword,broad_region,note` 컬럼)
- 코드는 시작 시 CSV를 dict로 로드 → `REGION_SUB_KEYWORDS`
- 이유: 키워드가 200+개로 커질 수 있어 코드 상수보다 CSV가 유지보수 유리

**핵심 시·군 예시 (전체 사전은 별도 CSV로 관리)**:

```
완도        → 전라남도
춘천        → 강원특별자치도
포항        → 경상북도
천안, 아산  → 충청남도
청주        → 충청북도
전주, 익산  → 전북특별자치도
창원, 김해  → 경상남도
... (전국 시·군 단위 약 200개)
```

**동음 지명 처리**:
- "광주" → 광역 사전에서 이미 광주광역시로 매핑되므로, 5단계에 진입하지 않음
- "고성" (강원 vs 경남), "광주시" (경기) 등 진성 동음 지명은 사전에서 **제외 또는 화이트리스트** 처리. 자동 매핑은 위험하므로 1차 사전에서는 제외 권장
- 사전 구축 시 행정구역 표준 데이터(통계청 KOSIS 등) 기반 + 동음 지명 수동 검토 1회

### 3.2 매칭 알고리즘

```python
def detect_sub_region(title: str, provider: str | None) -> str | None:
    text = f"{title or ''} {provider or ''}"
    if not text.strip():
        return None
    matches = []
    for kw, broad_region in REGION_SUB_KEYWORDS.items():
        for m in re.finditer(re.escape(kw), text):
            matches.append((m.start(), kw, broad_region))
    if not matches:
        return None
    matches.sort(key=lambda x: x[0])
    return matches[0][2]
```

### 3.3 핵심 효과 — 완도군 누락 사례 해결

| 사례 | 변경 전 | 변경 후 |
|------|---------|---------|
| `"완도군청년창업지원"` | 광역 키워드 없음 → 전국 fallback ❌ | 5단계에서 "완도" 매칭 → `전라남도` ✅ |
| `"춘천시 청년수당"` | 동일 문제 | 5단계에서 "춘천" 매칭 → `강원특별자치도` ✅ |
| `"포항창업진흥센터"` | 동일 문제 | 5단계에서 "포항" 매칭 → `경상북도` ✅ |

---

## 4. 노트북 적용 위치 (창엽 작업)

**파일**: `PolicyRec_v1_1_11.ipynb`
**대상 함수**: 현재 `region_rule.csv`를 읽어 region을 결정하는 함수 (예상 명칭: `resolve_region`, `apply_region_rule` 등)

**수정 후 의사 코드 (6단계 통합)**:

```python
def resolve_region(row, rules):
    title = row.get("title")
    provider = row.get("provider")

    # 1. title_bracket
    if region := match_title_bracket(row, rules):
        return region

    # 2. exact (부처/공공기관 → 전국)
    if region := match_exact(row, rules):
        return region

    # 3. prefix (광역시·도)
    if region := match_prefix(row, rules):
        return region

    # 4. ★ contains_broad (광역시·도 키워드)
    if region := detect_broad_region(title, provider):
        return region

    # 5. ★ contains_sub (시·군 키워드 → 광역 역매핑)
    if region := detect_sub_region(title, provider):
        return region

    # 6. fallback
    return "전국"
```

---

## 5. 알려진 함정 & 처리 방침

### 5.1 동음 지명 충돌

| 키워드 | 의도 | 충돌 가능 사례 | 처리 방침 |
|--------|------|----------------|-----------|
| 광주 | 광주광역시 | 경기도 광주시 | 4단계에서 광주광역시 우선. 경기 광주시는 향후 화이트리스트 |
| 고성 | (모호) | 강원 고성군 vs 경남 고성군 | 5단계 사전에서 **제외** (자동 매핑 불가) |
| 부산 | 부산광역시 | "부산물", "부산물품" | provider/title 단어 경계는 거의 항상 OK. 단어경계 정규식 권장(§3.2) |

### 5.2 부처명 우회

- 1·2단계가 먼저 작동하므로 "교육부", "고용노동부" 등은 4단계에 도달하지 않음
- 2단계에 등록되지 않은 신규 부처명은 4단계에서 오인식 가능 → 발견 시 `region_rule.csv`에 `exact → 전국` 룰 추가가 정공법

### 5.3 짧은 키워드 위험

- "서울", "부산" 등 2글자 키워드는 흔한 단어와 충돌 가능성 0은 아님
- 현재 데이터 기준 회귀 위험 낮음. 운영 중 오탐 발견 시 단어경계 정규식(`\b서울\b`은 한글에 부적합 → `(?<![가-힣])서울(?![가-힣])` 패턴) 또는 형태소 분석 기반으로 보강

---

## 6. summary 검사 범위 확장 (선택 옵션)

### 6.1 현재 사양 (기본)

검사 텍스트는 **`title + provider`만**. summary 본문에 우연히 등장하는 다른 지역명("서울에서 시작된...") 오인식 회피 목적.

### 6.2 확장 검토 — summary 포함 시 장단점

**장점**
- title/provider에 지역 키워드가 없고 summary에만 있는 케이스를 추가로 잡아냄
- 광역/시·군 매칭 커버리지 증가 → 전국 fallback 비율 추가 감소

**단점**
- 본문에 우연히 등장하는 무관한 지역명에 의한 오탐 위험
- 예: "서울대학교 출신 강사가 진행하는 충북 지역 창업 강좌" → 본문에 "서울"이 먼저 등장하면 서울특별시로 오인식

### 6.3 안전한 확장 권장안

summary 포함을 결정한다면 **반드시 다음 보호 장치 함께 적용**:

1. **텍스트 우선순위 분리 검사**:
   - 1차: `title + provider`만으로 4·5단계 시도
   - 2차: 위에서 실패 시에만 summary까지 포함하여 재검사
   - → title/provider 시그널이 있을 때는 summary가 흔들지 못함

2. **단어 경계 정규식**:
   ```python
   # 한글 단어 경계 (한글 문자 양옆에 다른 한글이 붙지 않을 때만 매치)
   pattern = rf"(?<![가-힣]){re.escape(kw)}(?![가-힣])"
   ```
   - "서울러", "서울대" 같은 합성어 매칭 차단
   - "부산물"의 "부산" 등 오탐 차단

3. **짧은 키워드 우선순위 조정**:
   - 광역(2글자) 검사 전에 시·군(2~3글자, 더 구체적) 먼저 시도하는 옵션 검토
   - 단, 동음 지명 처리와 함께 신중히

4. **운영 모니터링**:
   - 적용 후 region 분포 변화 + 무작위 샘플 100건 수동 검증
   - 오탐 발견 시 즉시 화이트리스트/제외 키워드 추가

### 6.4 의사결정 권고

- **1차 적용**: §6.1 기본(title+provider만) → 안전하게 출시
- **2차 적용**: §6.3 보호 장치 적용 후 summary 포함 → 커버리지 추가 확보

---

## 7. 검증 절차

### 7.1 노트북 단위 (창엽)

1. `detect_broad_region` / `detect_sub_region` 단위 테스트
   - 광역 17개 키워드 각각 매칭
   - 시·군 핵심 키워드(완도/춘천/포항/천안 등) 매칭
   - 다중 키워드 시 첫 등장 선택
   - 빈 문자열/None 처리
2. 정제 파이프라인 전체 재실행
   - 변경 전후 region 분포 비교 (`전국` 비율 감소량 측정)
   - 변경 전 `region="전국"`이었던 행 중 새로 광역시·도로 매핑된 케이스 무작위 100건 샘플링 검증

### 7.2 DB 적재 (보미)

1. 변경된 정제 결과로 `announcements` 재적재 또는 region 컬럼 update
2. region별 카운트 쿼리 → 합리적 분포 확인 (전국 비율이 합리적 범위인지)

### 7.3 웹앱 검증 (희민)

1. `web/app/api/search/route.ts` **수정 없음**
2. 인앱에서 광역시 필터 (예: 충청남도) → 천안/아산이 노출되고 대구 정책이 끼지 않는지 확인
3. 인앱에서 광역시 필터 (예: 전라남도) → 완도/광양 등 시·군 단위 정책이 함께 노출되는지 확인
4. 챗봇 RAG에 "대구 창업 지원", "완도 청년 정책" 질의 → 결과 적합성 확인

---

## 8. 향후 확장 (이번 범위 밖)

- 광주광역시 vs 경기 광주시 같은 진성 동음 지명 화이트리스트 보강
- 다중 광역 매칭 시 "복수 region" 컬럼 도입 검토
- NER/형태소 분석 기반 정확도 보강
- 시·군·구 외 읍·면·동 단위 키워드 (필요성 발생 시)

---

## 9. 변경 이력

| 날짜 | 작성 | 변경 |
|------|------|------|
| 2026-05-07 | 희민 (초안) | 신규 작성 — 5단계(title_bracket / exact / prefix / contains / fallback) 체계, title+provider 검사, 광역시·도 17개 키워드 사전 |
| 2026-05-07 | 희민 (개정) | E2E 테스트 결과 반영 (완도군 등 시·군 단위 추가 및 검사 범위 보완), 4-2단계를 5단계로 정식 편입하고 전체 넘버링을 6단계로 재편함. summary 검사 범위 확장 옵션(§6) 신설, 단어경계 정규식 권장안(§5.3·§6.3) 추가, 시·군 사전 별도 CSV 분리 권장 추가 |
