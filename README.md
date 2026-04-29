# PolicyRec

청년·예비창업자·소상공인·중소기업이 자신에게 맞는 정부·지자체·창업 지원사업을 더 쉽게 찾도록 돕는 데이터 준비 프로젝트입니다.

---

## 지금 어디까지 왔나 (2026-04-29)

| 버전 | 내용 | 상태 |
| :--- | :--- | :--- |
| `v1.0` | API 원본 수집 | ✅ 완료 |
| `v1.1.x` | 컬럼 정규화 + 룰표 + dedupe | ✅ 완료 (v1.1.6 / 553건) |
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
│  │  ├─ main/main_v1_1_6.csv     ← 임베딩 입력용 최종 (553건)
│  │  └─ review/                  ← 자매 공고 수동 검토 큐
│  └─ embedding/                  ← Gemini 임베딩 캐시 (v1.2.x 생성 예정)
├─ app/collectors/, norm.py       ← API 수집·정규화 모듈
├─ PolicyRec_v1_1_6.ipynb         ← 현재 최신 정제 노트북
├─ SPEC_데이터구조참조_v1.1.6.md    ← 컬럼 사전 (상시 참조)
├─ STEP_작업실행지침_v1.2.x.md      ← v1.2.x 작업 실행 가이드
├─ Database/
│  ├─ supabase_readme.md          ← DB 설정 + 적재 가이드
│  ├─ ERD_table_info_v1.md        ← 테이블 구조 및 활용 정리
│  ├─ RPC_contract_v1.md          ← RPC 인터페이스 명세
│  ├─ RPC_match_announcements_hybrid_v1.sql  ← RPC 함수 정의
│  └─ RPC_test_cases_v1.sql       ← 적재 검증 SQL
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
| 컬럼이 뭔지 모르겠다 | [`SPEC_데이터구조참조_v1.1.6.md`](SPEC_데이터구조참조_v1.1.6.md) |
| v1.2.x 노트북/적재 파이프라인을 봐야 한다 | [`Database/supabase_readme.md`](Database/supabase_readme.md) |
| Supabase 테이블, RPC 생성, 테스트 실행 순서를 봐야 한다 | [`Database/supabase_readme.md`](Database/supabase_readme.md) |
| Next.js API에서 RPC 입력/출력 계약을 확인해야 한다 | [`Database/RPC_contract_v1.md`](Database/RPC_contract_v1.md) |

---

## DB / Supabase 문서 기준

DB/Supabase 작업의 중심 문서는 [`Database/supabase_readme.md`](Database/supabase_readme.md)입니다.

Supabase 테이블 생성, 데이터 적재 기준, RPC 생성, RPC 테스트 실행 순서는 이 문서를 기준으로 확인합니다.

관련 파일:
- [`Database/ERD_table_info_v1.md`](Database/ERD_table_info_v1.md): 테이블 구조와 활용 정리
- [`Database/RPC_match_announcements_hybrid_v1.sql`](Database/RPC_match_announcements_hybrid_v1.sql): Supabase SQL Editor에서 실행할 RPC 함수
- [`Database/RPC_test_cases_v1.sql`](Database/RPC_test_cases_v1.sql): Supabase SQL Editor에서 실행할 테스트 SQL
- [`Database/RPC_contract_v1.md`](Database/RPC_contract_v1.md): Next.js API/프론트 구현용 RPC 입력·출력 계약
