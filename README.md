# PolicyRec

청년·예비창업자·소상공인·중소기업이 자신에게 맞는 정부·지자체·창업 지원사업을 더 쉽게 찾도록 돕는 데이터 준비 프로젝트입니다.

---

## 지금 어디까지 왔나 (2026-04-28)

| 버전 | 내용 | 상태 |
| :--- | :--- | :--- |
| `v1.0` | API 원본 수집 | ✅ 완료 |
| `v1.1.x` | 컬럼 정규화 + 룰표 + dedupe | ✅ 완료 (v1.1.6 / 554건) |
| `v1.2.x` | Supabase 임베딩 적재 파이프라인 | 🔨 진행 중 |
| `v1.3` | Hybrid Search 검증 | 예정 |
| `v1.4` | LLM 태그 추출 + 추천 이유 생성 | 예정 |
| `v2.0` | 첨부파일 PDF/HWP 본문 RAG | 예정 |

---

## 지금 당장 실행할 것

```
1단계 (완료) → PolicyRec_v1_1_6.ipynb 실행
               결과: data/csv/main/main_v1_1_6.csv

2단계 (진행 중) → v1.2.x 노트북 제작 후 실행
                  결과: Supabase announcements 테이블에 임베딩 적재

3단계 (예정) → Hybrid Search 검증
               SQL 필터 + 벡터 유사도 결합 확인
```

---

## 폴더 구조

```text
PolicyRec/
├─ data/
│  ├─ raw/biz, kst, youth/        ← API 원본 JSON
│  ├─ csv/
│  │  ├─ raw/raw_v1_1_6.csv       ← API 원본 600건
│  │  ├─ rule/                    ← 카테고리·스코프 룰표
│  │  ├─ main/main_v1_1_6.csv     ← 임베딩 입력용 최종 (554건)
│  │  └─ review/                  ← 자매 공고 수동 검토 큐
│  └─ embedding/                  ← Gemini 임베딩 캐시
├─ app/collectors/, norm.py       ← API 수집·정규화 모듈
├─ PolicyRec_v1_1_6.ipynb         ← 현재 최신 정제 노트북
├─ 데이터구조참조_v1.1.6.md         ← 컬럼 사전 (상시 참조)
├─ 작업실행지침_v1.2.x.md           ← v1.2.x 작업 실행 가이드
├─ supabase_readme.md
├─ streamlit_app3_2.py            ← 현재 메인 UI
└─ README.md
```

---

## 설치

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1        # Windows PowerShell
pip install -r requirements.txt
```

`.env` 파일 (프로젝트 루트에 생성):

```env
BIZINFO_API_KEY=...
KSTARTUP_API_KEY=...
YOUTHCENTER_API_KEY=...
GOOGLE_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

---

## 막혔을 때 보는 문서

| 이럴 때 | 볼 문서 |
| :--- | :--- |
| 컬럼이 뭔지 모르겠다 | [`데이터구조참조_v1.1.6.md`](데이터구조참조_v1.1.6.md) |
| v1.2.x 노트북 만들어야 한다 | [`작업실행지침_v1.2.x.md`](작업실행지침_v1.2.x.md) |
| Supabase DB 구조 보고 싶다 | [`supabase_readme.md`](supabase_readme.md) |
