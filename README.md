# PolicyRec

청년 지원 정책 공고를 한 곳에서 검색하고, 자연어 / 조건 / 챗봇으로 맞춤 추천을 받을 수 있는 통합 플랫폼입니다.
공공 API에서 수집한 정책 데이터를 정제하고 Supabase + pgvector로 임베딩 저장한 뒤, Next.js 웹 앱에서 검색·추천·챗봇 기능을 제공합니다.

## 지금 어디까지 왔나 (2026-05-14)

| 단계 | 내용 | 상태 |
| :--- | :--- | :--- |
| `v1.0` | API 원본 수집 (BizInfo, K-Startup, YouthCenter) | ✅ 완료 |
| `v1.1.x` | 컬럼 정규화 + 룰표 + dedupe | ✅ 완료 (v1.1.12 / 565건 / 29컬럼) |
| `v1.2.x` | Supabase + Gemini 임베딩 적재 파이프라인 | ✅ 완료 |
| `v1.3` | Hybrid Search RPC (`match_announcements_hybrid`) | ✅ 완료 |
| 웹 앱 | Next.js 기반 검색·추천·챗봇 UI | ✅ MVP 완료 |
| 자동 수집 | GitHub Actions 주간 배치 (매주 수요일 06:00 KST) | ✅ 운영 중 |
| `v1.4` | LLM 태그 추출 + 추천 이유 자연어 생성 | 예정 |
| `v2.0` | 첨부파일 PDF/HWP 본문 RAG 확장 | 예정 |

---

## 핵심 기능

- **통합검색**: 자연어 문장 검색. Gemini embedding + pgvector 유사도 검색
- **조건검색**: 지역·분야·나이 필터 기반 검색. 조건 적합도(condition_score)로 정렬
- **정렬 모드**: 추천순(관련도 또는 조건 적합도), 마감순, 신규순
- **스크랩**: 관심 공고 저장, 마이페이지에서 분야별 조회
- **AI 추천**: 프로필 기반 + 스크랩 이력 기반 맞춤 추천
- **RAG 챗봇**: 자연어 질의, 신청 가이드, 대화 맥락 유지, 프로필 충돌 시 confirm 흐름
- **관리자 대시보드**: 공고 현황 / 사용자 통계 / 공고 데이터 조회 (read-only)

---

## 폴더 구조

```text
PolicyRec/
├─ .github/workflows/
│  └─ weekly_collect.yml                # GitHub Actions 주간 수집 자동화
├─ app/                                  # 데이터 수집·정제 모듈
│  ├─ collectors/                        # BizInfo / K-Startup / Youth API 클라이언트
│  │  ├─ base.py, biz.py, kst.py, youth.py
│  ├─ norm.py                            # 정규화 함수
│  ├─ schema.py                          # 공통 스키마
│  └─ attachments.py                     # 첨부파일 처리
├─ data/
│  ├─ csv/main/main_v1_1_12.csv         # 임베딩 입력용 최종 565건 / 29컬럼
│  ├─ csv/raw/raw_v1_1_8.csv            # API 원본
│  ├─ csv/rule/                          # 룰표 (cat / region / scope / target_tags)
│  └─ raw/biz/, kst/, youth/             # API JSON 원본
├─ Database/                             # Supabase 스키마 / RPC 정의
│  ├─ ERD_v1_Logical.png, ERD_v1_Physical.png
│  ├─ ERD_table_info_v1.md
│  ├─ RPC_contract_v1.md
│  ├─ RPC_match_announcements_hybrid_v1.sql
│  ├─ RPC_retrieve_only_announcements.sql
│  ├─ RPC_test_cases_v1.sql
│  ├─ saved_chats_ddl.sql
│  └─ supabase_readme.md
├─ docs/
│  ├─ E2E_CHECKLIST.md
│  ├─ PLAN_NEXTJS.md
│  ├─ QA_수정로그_및_공유메모_2026-05-13.md
│  ├─ SPEC_데이터구조참조_v1.1.6.md
│  ├─ SPEC_지역결정룰.md
│  └─ STEP_작업실행지침_v1.2.x.md
├─ scripts/
│  └─ fetch.py                           # 수집 진입점 (yml에서 호출)
├─ web/                                  # Next.js 웹 앱
│  ├─ app/
│  │  ├─ page.tsx                        # 메인 + 통합/조건검색
│  │  ├─ mypage/page.tsx                 # 마이페이지 (프로필)
│  │  ├─ scraps/page.tsx                 # 스크랩 + AI 추천
│  │  ├─ profile/page.tsx                # 프로필 수정
│  │  ├─ admin/page.tsx                  # 관리자 대시보드
│  │  └─ api/
│  │     ├─ search/route.ts              # 통합·조건검색
│  │     ├─ chat/rag/route.ts            # RAG 챗봇
│  │     ├─ mypage/recommendations/route.ts  # AI 맞춤 추천
│  │     ├─ mypage/scraps/route.ts       # 스크랩 토글
│  │     ├─ announcements/by-ids/        # 공고 일괄 조회
│  │     ├─ auth/                        # 로그인 / 회원가입
│  │     ├─ admin/stats/                 # 관리자 통계
│  │     └─ user/                        # 프로필·필터·알림·대화
│  ├─ components/                        # AppHeader, AuthDialog, PolicyCard
│  ├─ lib/                               # supabase, gemini, auth, types
│  └─ package.json
├─ archive/                              # 이전 노트북 / Streamlit 앱 / 이전 CSV 보관
├─ PolicyRec_v1_1_12.ipynb              # 현재 정제 노트북 (메인)
├─ policyRec_v1_2_3.ipynb               # 현재 임베딩·적재 노트북
├─ CHANGELOG.md
└─ README.md
```

---

## 기술 스택

### 데이터 파이프라인
- **Python 3.11**: 수집 / 정제 / 임베딩
- **공공 API**: BizInfo, K-Startup, YouthCenter
- **Pandas / NumPy**: 데이터 처리
- **Jupyter Notebook**: 정제 / 임베딩 노트북

### 백엔드 / DB
- **Supabase (Postgres + pgvector)**: 공고 데이터 + 임베딩 저장
- **RPC 함수**:
  - `match_announcements_hybrid`: 필터 + 유사도 결합 검색
  - `retrieve_only_announcements`: 의미 유사도 only 검색
- **Gemini API**: 텍스트 embedding 생성 및 챗봇 답변

### 프론트엔드
- **Next.js 16.2.4** (App Router, TypeScript 5)
- **React 19.2.4**
- **TailwindCSS 4**: 스타일
- **@supabase/supabase-js 2.105**: Supabase 클라이언트
- **@google/genai 1.52**: Gemini SDK (embedding + 답변 생성)

### 자동화
- **GitHub Actions**: 매주 수요일 06:00 KST(화 21:00 UTC) 자동 수집
- **jupyter nbconvert**: 노트북 자동 실행

---

## 시작 방법

### 데이터 파이프라인 (Python)

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 웹 앱 (Next.js)

```bash
cd web
npm install
npm run dev
```

### 환경 변수

루트 `.env` (Python 파이프라인 / 노트북용):

```env
BIZINFO_API_KEY=...
KSTARTUP_API_KEY=...
YOUTHCENTER_API_KEY=...
GOOGLE_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

`web/.env.local` (Next.js 앱용):

```env
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
SUPABASE_KEY=...
GEMINI_API_KEY=...
```

---

## 주요 문서

| 이럴 때 | 볼 문서 |
| :--- | :--- |
| 컬럼이 뭔지 모르겠다 | [`docs/SPEC_데이터구조참조_v1.1.6.md`](docs/SPEC_데이터구조참조_v1.1.6.md) |
| v1.2.x 작업 실행 지침 | [`docs/STEP_작업실행지침_v1.2.x.md`](docs/STEP_작업실행지침_v1.2.x.md) |
| Supabase 설정 / RPC 적재 | [`Database/supabase_readme.md`](Database/supabase_readme.md) |
| ERD / 테이블 활용 | [`Database/ERD_table_info_v1.md`](Database/ERD_table_info_v1.md) |
| RPC 입출력 계약 | [`Database/RPC_contract_v1.md`](Database/RPC_contract_v1.md) |
| 지역 결정 룰 | [`docs/SPEC_지역결정룰.md`](docs/SPEC_지역결정룰.md) |
| QA 수정 로그 | [`docs/QA_수정로그_및_공유메모_2026-05-13.md`](docs/QA_수정로그_및_공유메모_2026-05-13.md) |
| 변경 이력 | [`CHANGELOG.md`](CHANGELOG.md) |

---

## 자동 수집 흐름

GitHub Actions가 매주 수요일 06:00 KST(화 21:00 UTC)에 자동 실행:

1. BizInfo / K-Startup / YouthCenter API 호출 → raw JSON 저장
2. `scripts/fetch.py`로 정규화 → `raw_v1_1_8.csv` 생성
3. 정제 노트북 자동 실행 (`PolicyRec_v1_1_12.ipynb`) → `main_v1_1_12.csv` 생성
4. 결과 파일을 `data/` 폴더에 commit & push

> Supabase 적재(임베딩 생성 + DB upsert)는 별도 노트북으로 수동 수행. 자동화는 향후 작업 예정.

---

## 팀 작업 분담

| 담당자 | 영역 |
| :--- | :--- |
| **유창엽** | 데이터 수집·정제 메인 노트북, 자동 수집 yml, 검색·정렬 로직 |
| **김보미** | Gemini 임베딩, Supabase 적재, 추천 RPC, 평가 지표 |
| **권희민** | Next.js, E2E 테스트(UI / API Route / 챗봇 RAG) |
