# PolicyRec

PolicyRec은 청년, 예비창업자, 소상공인, 중소기업이 자신에게 맞는 정부·지자체·창업 지원사업을 더 쉽게 찾도록 돕기 위한 데이터 준비 프로젝트입니다.

현재 프로젝트는 v1.0 원본 통합을 마치고, 팀 공유본인 v1.1 정규화 결과를 화면에서 검토하는 단계입니다.

v1.0에서는 공식 API에서 받은 원본 데이터를 안전하게 확인하고 **원본 컬럼명 그대로 하나의 CSV로 통합**했습니다. v1.1에서는 그 결과를 바탕으로 세 API의 서로 다른 컬럼명을 공통 컬럼으로 정리합니다.

추가로 `streamlit_app.py`를 통해 v1.1 정규화 CSV를 카드 리스트 화면으로 미리 확인할 수 있습니다. 이 앱은 최종 서비스가 아니라, 팀이 정규화 결과가 화면에서 어떻게 보일지 빠르게 검토하기 위한 프로토타입입니다.

## 현재 목표

1. v1.0 결과인 `data/clean/combined_raw_columns.csv`를 기준 데이터로 사용합니다.
2. Bizinfo, K-Startup, Youthcenter의 서로 다른 원본 컬럼을 공통 컬럼으로 정리합니다.
3. v1.1 결과인 `data/clean/combined_normalized_v1_1.csv`를 화면에서 확인합니다.
4. `streamlit_app.py`는 v1.1 정규화 CSV를 읽어 카드 리스트로 보여줍니다.

## 아직 하지 않는 것

- 추천 모델 구현
- 공고별 Q&A
- SQLite/Chroma 인덱스 구축
- 클라우드 배포
- Gemma 기반 추천 이유 생성
- 첨부파일 PDF/HWP 본문 RAG

## 버전 로드맵

이 프로젝트는 아래 순서로 확장합니다. 각 단계는 이전 단계의 CSV를 입력으로 삼고, 다음 단계가 바로 사용할 수 있는 결과물을 남기는 방식으로 진행합니다.

| 버전 | 목표 | 상태 | 주요 결과물 |
| :--- | :--- | :--- | :--- |
| `v1.0` | API 원본 통합 | 완료 | `data/clean/combined_raw_columns.csv` |
| `v1.1` | 서비스용 공통 컬럼 정규화 | 진행 중 | `data/clean/combined_normalized_v1_1.csv` |
| `v1.2` | SQLite + Chroma 인덱스 구축 | 예정 | `data/db/policy.sqlite`, `data/vector/chroma/` |
| `v1.3` | 규칙 기반 추천 검증 | 예정 | SQL 필터 + RAG Top-K + 점수 결합 |
| `v1.4` | Gemma 연동 RAG 완성 | 예정 | 추천 이유 자연어 생성 |
| `v1.5` | Streamlit UI 통합 | 예정 | 폼 입력 + 자연어 검색 UI |
| `v2.0` | 첨부파일 PDF/HWP 본문 RAG 확장 | 예정 | 공고 목록 + 첨부파일 본문 검색 |

### 로드맵 현실성 판단

현재 데이터가 30행 내외이므로 v1.2와 v1.3은 현실적인 다음 단계입니다. SQLite는 나이, 지역처럼 정형 조건을 빠르게 거르는 데 적합하고, Chroma는 `summary`처럼 문장형 텍스트를 의미 검색하는 데 적합합니다.

v1.4 Gemma 연동도 프로토타입 범위에서는 현실적입니다. 다만 이 단계는 추천 후보를 새로 찾는 단계가 아니라, v1.3에서 이미 고른 후보에 대해 “왜 추천했는지” 설명을 붙이는 단계로 제한하는 것이 안전합니다.

v2.0 첨부파일 RAG는 뒤로 미루는 것이 현실적입니다. PDF/HWP는 파일 형식, 인코딩, 스캔 이미지 여부, 압축파일 예외가 많기 때문에 목록 데이터 기반 추천이 안정된 뒤 붙이는 편이 좋습니다.

### v1.0: API 호출 + 원본 그대로 통합 CSV

현재 `PolicyRec_v1.0.ipynb`가 담당하는 단계입니다.

v1.0에서는 API에서 받은 원본 컬럼명을 바꾸지 않습니다. 세 API가 비슷한 의미의 컬럼을 가지고 있어도, 아직 하나의 공통 컬럼으로 합치지 않습니다.

예:

- Bizinfo 제목 후보: `pblancNm`
- K-Startup 제목 후보: `intg_pbanc_biz_nm`
- Youthcenter 제목 후보: `plcyNm`

이 값들은 나중에 모두 `title` 같은 공통 컬럼으로 정리할 수 있지만, v1.0에서는 그대로 둡니다. 원본을 잃지 않고 구조를 먼저 이해하는 것이 목표입니다.

### v1.1: 서비스용 확장 정규화

v1.1에서는 v1.0 결과를 기반으로 추천, 검색, 필터, 개인화에 필요한 공통 컬럼을 만듭니다.

현재 팀 공유 기준 파일은 `PolicyRec_v1.1.ipynb`입니다.

현재 기준 작업:

- `combined_raw_columns.csv` 읽기
- `_source` 기준으로 `biz`, `kst`, `youth` 나누기
- source별 원본 컬럼을 팀 공통 컬럼으로 매핑하기
- 컬럼명 통일
- 날짜 형식 통일
- `target_age_min`, `target_age_max` 생성
- 지역, 대상, 카테고리, 상세 URL 정리
- 결과를 `data/clean/combined_normalized_v1_1.csv`로 저장

v1.1은 “원본 CSV를 덮어쓰기”가 아니라, v1.0 결과를 바탕으로 정규화된 파일을 새로 만드는 방향이 안전합니다.

현재 v1.1 목표 컬럼:

- `source`
- `source_id`
- `title`
- `summary`
- `category`
- `region`
- `target_group`
- `target_age_min`
- `target_age_max`
- `start_date`
- `end_date`
- `detail_url`

`source`는 팀 가이드라인의 공통 컬럼이므로 원본의 `_source`를 화면과 후속 처리에서 쓰기 쉬운 `source`로 정리합니다.

### v1.2: SQLite + Chroma 인덱스 구축

v1.2에서는 v1.1 정규화 CSV를 읽어서 두 가지 저장소를 만듭니다.

- SQLite: 나이, 지역, 혜택 유형, 날짜 상태 같은 정형 필터용
- Chroma: `summary` 의미 검색용

정형 필터와 의미 검색을 분리하는 이유는 두 검색 방식이 잘하는 일이 다르기 때문입니다. 예를 들어 “19세 청년”은 숫자 범위 필터가 정확하고, “온라인 쇼핑몰 창업”은 의미 검색이 더 유연합니다.

### v1.3: 규칙 기반 추천

v1.3에서는 LLM을 붙이지 않고 추천 후보가 제대로 나오는지 먼저 검증합니다.

이 단계에서 SQL 필터, RAG Top-K, 점수 결합 로직을 확인해야 v1.4에서 Gemma가 그럴듯한 문장을 만들어도 실제 추천 품질이 흔들리지 않습니다.

### v1.4: Gemma 연동

v1.4에서는 Google AI Studio 무료 티어 Gemma를 사용해 추천 이유를 자연어로 생성합니다.

Gemma는 추천 후보를 고르는 주체가 아니라, 이미 계산된 추천 결과를 사용자에게 이해하기 쉽게 설명하는 역할로 제한합니다.

### v1.5: Streamlit UI 통합

v1.5에서는 폼 입력과 자연어 입력을 함께 받는 화면을 만듭니다.

폼 입력은 나이, 지역, 혜택 유형처럼 명확한 조건에 쓰고, 자연어 입력은 “서울에서 온라인 쇼핑몰 창업하고 싶다”처럼 자유로운 문장 검색에 씁니다.

### v2.0: 첨부파일 본문 RAG 확장

v2.0에서는 공고 목록만으로 부족한 정보를 첨부파일에서 가져옵니다.

예상 작업:

- 공고별 첨부파일 위치 확인
- 공고 item과 첨부파일 연결
- PDF/HWP 등에서 텍스트 추출
- 첨부파일 본문을 요약이나 검색에 활용할 수 있게 정리
- 필요하면 v1.1의 정규화 기준 재조정

첨부파일은 파일 형식과 예외가 많기 때문에, 목록 데이터가 안정된 뒤 붙이는 것이 좋습니다.

## 핵심 노트북

현재 기준으로 가장 중요한 노트북은 아래 두 개입니다.

```text
PolicyRec_v1.0.ipynb
PolicyRec_v1.1.ipynb
```

`PolicyRec_v1.0.ipynb`는 원본 데이터를 모으는 노트북입니다. 초보자도 따라가기 쉽게 아래 순서로 구성되어 있습니다.

1. 설정값과 helper 함수 준비
2. 프로젝트 폴더 상태 확인
3. 필요 시 API 재호출
4. source별 최신 raw 파일 확인
5. JSON 구조와 대표 item 확인
6. 원본 컬럼 그대로 CSV 통합
7. 통합 결과 검증

`PolicyRec_v1.1.ipynb`는 팀 공유 기준의 정규화 데이터를 만드는 노트북입니다.

1. v1.0 결과 CSV 읽기
2. source별 원본 컬럼을 공통 컬럼으로 매핑
3. 날짜 형식 정리
4. 나이 필터용 숫자 컬럼 생성
5. 서비스용 정규화 CSV 저장

`PolicyRec_v1.0.ipynb`에서 바꿀 가능성이 있는 값은 첫 번째 코드 셀 위쪽에 모아 두었습니다.

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
│  │  ├─ combined_raw_columns.csv
│  │  └─ combined_normalized_v1_1.csv
│  └─ attachments/
├─ scripts/
│  └─ fetch.py
├─ PolicyRec_v1.0.ipynb
├─ PolicyRec_v1.1.ipynb
├─ streamlit_app.py
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

## Streamlit 앱 실행 방법

v1.1 정규화 CSV를 카드 리스트 화면으로 확인하려면 아래 파일을 실행합니다.

```text
streamlit_app.py
```

실행 명령:

```bash
streamlit run streamlit_app.py
```

실행 후 보통 아래 주소에서 열립니다.

```text
http://localhost:8501
```

현재 앱의 목적:

- 기본으로 `data/clean/combined_normalized_v1_1.csv`를 불러옵니다.
- v1.1 공통 컬럼인 `title`, `summary`, `category`, `target_group`, `target_age_min`, `target_age_max`를 화면에 보여줍니다.
- 통합검색창에서 사업명과 summary를 기준으로 필터링합니다.
- 정책 정보를 3열 카드 형태로 보여줍니다.
- 북마크 버튼으로 스크랩 상태를 관리합니다.

중요:

- 이 앱은 v1.1 정규화 결과 리뷰용 미리보기 앱입니다.
- 앱 기준 파일은 팀 공유 노트북 `PolicyRec_v1.1.ipynb`의 결과물인 `combined_normalized_v1_1.csv`입니다.
- 스크랩 상태는 `st.session_state`에 저장되므로, 앱을 새로 시작하면 초기화됩니다.

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
