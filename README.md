# PolicyRec

PolicyRec은 청년, 예비창업자, 소상공인, 중소기업이 자신에게 맞는 정부·지자체·창업 지원사업을 더 쉽게 찾도록 돕기 위한 데이터 준비 프로젝트입니다.

현재 v1.0의 목표는 추천 모델을 바로 만드는 것이 아니라, 먼저 공식 API에서 받은 원본 데이터를 안전하게 확인하고 **원본 컬럼명 그대로 하나의 CSV로 통합**하는 것입니다.

## 현재 목표

1. Bizinfo, K-Startup, Youthcenter raw 데이터를 확인합니다.
2. 각 API 응답에서 실제 공고 목록이 어디에 있는지 파악합니다.
3. 원본 컬럼명을 바꾸지 않고 그대로 유지합니다.
4. 세 source 데이터를 하나의 CSV로 합칩니다.
5. 결과를 `data/clean/combined_raw_columns.csv`에 저장합니다.

## 아직 하지 않는 것

- 추천 모델 구현
- 요약 카드 생성
- 공고별 Q&A
- 데이터베이스 구축
- 클라우드 배포
- 원본 컬럼을 공통 컬럼으로 바꾸는 정규화

## 버전별 개발 계획

이 프로젝트는 아래 순서로 확장합니다.

| 버전 | 목표 | 주요 결과물 |
| :--- | :--- | :--- |
| `v1` | API 호출 + 원본 그대로 통합 CSV | `data/clean/combined_raw_columns.csv` |
| `v1.n` | v1 기반 + 최소 정규화 | 컬럼명, 날짜 형식, 결측값 기준을 맞춘 CSV |
| `v2` | v1.n 기반 + 첨부파일 추가 | 공고 목록 + 첨부파일 정보가 연결된 데이터 |

### v1: API 호출 + 원본 그대로 통합 CSV

현재 `PolicyRec_v1.0.ipynb`가 담당하는 단계입니다.

v1에서는 API에서 받은 원본 컬럼명을 바꾸지 않습니다. 세 API가 비슷한 의미의 컬럼을 가지고 있어도, 아직 하나의 공통 컬럼으로 합치지 않습니다.

예:

- Bizinfo 제목 후보: `pblancNm`
- K-Startup 제목 후보: `intg_pbanc_biz_nm`
- Youthcenter 제목 후보: `plcyNm`

이 값들은 나중에 모두 `title` 같은 공통 컬럼으로 정리할 수 있지만, v1에서는 그대로 둡니다. 원본을 잃지 않고 구조를 먼저 이해하는 것이 목표입니다.

### v1.n: 최소 정규화

v1.n에서는 v1 결과를 기반으로 추천과 검색에 필요한 최소한의 공통 컬럼을 만듭니다.

예상 작업:

- 컬럼명 통일
- 날짜 형식 통일
- 결측값 처리 기준 정하기
- 지역, 대상, 나이, 신청 기간, 상세 URL 같은 추천 후보 컬럼 선별

v1.n은 “원본 CSV를 덮어쓰기”가 아니라, v1 결과를 바탕으로 정규화된 파일을 새로 만드는 방향이 안전합니다.

### v2: 첨부파일 추가

v2에서는 공고 목록만으로 부족한 정보를 첨부파일에서 가져옵니다.

예상 작업:

- 공고별 첨부파일 위치 확인
- 공고 item과 첨부파일 연결
- PDF/HWP 등에서 텍스트 추출
- 첨부파일 본문을 요약이나 검색에 활용할 수 있게 정리
- 필요하면 v1.n의 정규화 기준 재조정

첨부파일은 파일 형식과 예외가 많기 때문에, 목록 데이터가 안정된 뒤 붙이는 것이 좋습니다.

## 핵심 노트북

가장 먼저 볼 파일은 아래 노트북입니다.

```text
PolicyRec_v1.0.ipynb
```

이 노트북은 초보자도 따라가기 쉽게 아래 순서로 구성되어 있습니다.

1. 설정값과 helper 함수 준비
2. 프로젝트 폴더 상태 확인
3. 필요 시 API 재호출
4. source별 최신 raw 파일 확인
5. JSON 구조와 대표 item 확인
6. 원본 컬럼 그대로 CSV 통합
7. 통합 결과 검증

바꿀 가능성이 있는 값은 첫 번째 코드 셀 위쪽에 모아 두었습니다.

- `SOURCES`
- `PAGE`, `PAGE_SIZE`
- `RUN_FETCH`, `FORCE_FETCH`
- `RAW_FILE_PATTERNS`
- `MAX_TOP_LEVEL_KEYS`
- `MAX_SAMPLE_ITEM_KEYS`
- `TEXT_PREVIEW_LENGTH`
- `PREVIEW_ROW_COUNT`
- `CSV_ENCODING`
- `PREVIEW_FIELDS`
- `STATUS_MESSAGES`

## 폴더 구조

```text
PolicyRec/
├─ app/
│  ├─ collectors/
│  │  ├─ base.py
│  │  ├─ biz.py
│  │  ├─ kst.py
│  │  └─ youth.py
│  ├─ attachments.py
│  ├─ norm.py
│  └─ schema.py
├─ data/
│  ├─ raw/
│  │  ├─ biz/
│  │  ├─ kst/
│  │  └─ youth/
│  ├─ clean/
│  │  └─ combined_raw_columns.csv
│  └─ attachments/
├─ scripts/
│  └─ fetch.py
├─ PolicyRec_v1.0.ipynb
├─ requirements.txt
└─ README.md
```

## 설치 방법

프로젝트 루트로 이동합니다.

```bash
cd C:\Users\min2m\github\PolicyRec
```

가상환경은 선택사항이지만 권장합니다.

```bash
python -m venv .venv
```

Windows PowerShell에서 가상환경을 켭니다.

```bash
.venv\Scripts\Activate.ps1
```

필요한 패키지를 설치합니다.

```bash
pip install -r requirements.txt
```

## .env 파일

API를 새로 호출하려면 프로젝트 루트에 `.env` 파일이 필요합니다.

예시:

```env
BIZINFO_API_KEY=여기에_기업마당_키를_직접_입력
KSTARTUP_API_KEY=여기에_KSTARTUP_키를_직접_입력
YOUTHCENTER_API_KEY=여기에_온통청년_키를_직접_입력
```

중요:

- 실제 API 키는 코드나 노트북 안에 직접 넣지 않습니다.
- `.env` 파일은 `.gitignore`에 포함되어 있어야 합니다.
- 이미 저장된 `data/raw` 파일만 분석할 때는 API 키가 없어도 됩니다.

## 노트북 실행 방법

Jupyter 또는 VS Code에서 아래 파일을 엽니다.

```text
PolicyRec_v1.0.ipynb
```

처음에는 첫 번째 코드 셀의 기본값 그대로 실행하는 것을 권장합니다.

```python
RUN_FETCH = False
```

이 상태에서는 API를 새로 호출하지 않고, 이미 저장된 `data/raw` 파일을 읽어서 통합 CSV를 만듭니다.

API를 다시 호출하고 싶을 때만 아래처럼 바꿉니다.

```python
RUN_FETCH = True
```

## fetch 스크립트 실행 방법

노트북이 아니라 터미널에서 직접 수집하려면 아래 명령을 사용합니다.

기본 실행:

```bash
python scripts/fetch.py
```

기존 캐시를 무시하고 다시 호출:

```bash
python scripts/fetch.py --force
```

특정 source만 실행:

```bash
python scripts/fetch.py --sources biz
python scripts/fetch.py --sources biz kst
```

`scripts/fetch.py --normalize` 옵션과 `app/norm.py`는 기존 정규화 실험용 코드입니다. v1.0 노트북의 핵심 목표는 정규화가 아니라 `combined_raw_columns.csv` 생성입니다.

## 데이터 저장 방식

### raw 데이터

각 source의 원본 응답은 아래 폴더에 저장됩니다.

```text
data/raw/<source>/
```

예:

```text
data/raw/biz/bizinfo_page1_size10_20260421_122751.json
data/raw/kst/kstartup_page1_size10_20260421_122753.json
data/raw/youth/youthcenter_page1_size10_20260421_122753.json
```

raw 데이터를 남겨 두는 이유:

- 원본 응답을 잃지 않습니다.
- API 구조가 바뀌었는지 다시 확인할 수 있습니다.
- 나중에 정규화 규칙을 바꿔도 raw 파일에서 다시 만들 수 있습니다.

### clean 데이터

v1.0 노트북의 결과 파일은 아래입니다.

```text
data/clean/combined_raw_columns.csv
```

이 파일의 특징:

- 세 API 데이터를 하나의 CSV로 합칩니다.
- 원본 컬럼명은 바꾸지 않습니다.
- source마다 없는 컬럼은 빈칸으로 남습니다.
- Excel 한글 깨짐을 줄이기 위해 `utf-8-sig`로 저장합니다.

추가되는 관리용 컬럼:

- `_source`: `biz`, `kst`, `youth`
- `_source_name`: 사람이 읽기 쉬운 source 이름
- `_source_file`: 해당 row가 나온 raw 파일
- `_source_row_number`: source 안에서 몇 번째 item인지

## 현재 확인된 통합 결과

현재 샘플 raw 파일 기준 결과는 아래와 같습니다.

- 전체: 30행 x 116컬럼
- Bizinfo: 10행, 원본 컬럼 22개
- K-Startup: 10행, 원본 컬럼 26개
- Youthcenter: 10행, 원본 컬럼 60개

## 다음 작업

1. `combined_raw_columns.csv`를 보면서 추천과 요약에 쓸 원본 컬럼을 고릅니다.
2. 필요한 시점에만 별도 정규화 CSV를 만듭니다.
3. 사용자 조건 입력값을 정합니다.
4. 조건 기반 필터링과 추천 점수 계산으로 넘어갑니다.
5. 요약 카드와 Q&A 기능을 붙입니다.

## 설계 메모

지금 단계에서는 “정답 형태의 깨끗한 테이블”보다 “원본을 잃지 않는 통합본”이 더 중요합니다.

그래서 v1.0은 아래 기준을 우선합니다.

- raw 응답을 먼저 안전하게 저장
- 원본 컬럼명 유지
- source별 차이를 빈칸으로 허용
- 초보자도 설정값을 쉽게 바꿀 수 있도록 코드 상단에 모아두기
- Excel에서 열어도 한글이 깨지지 않도록 저장
