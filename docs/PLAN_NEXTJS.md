# Next.js 작업 기준

## 목적

최소 완성 목표는 배포 URL에서 아래 흐름이 동작하는 것이다.

1. 사용자가 자연어 검색어를 입력한다.
2. `/api/search`가 Gemini embedding을 생성한다.
3. Supabase `match_announcements_hybrid` RPC가 결과를 반환한다.
4. Next.js 화면이 결과를 카드로 보여준다.
5. 카테고리, 지역, 나이, 모집상태 필터가 적용된다.

## 기준 파일

| 영역 | 파일 |
| :--- | :--- |
| 최종 정제 CSV | `data/csv/main/main_v1_1_9.csv` |
| raw 기준 CSV | `data/csv/raw/raw_v1_1_8.csv` |
| 임베딩/적재 노트북 | `policyRec_v1_2_3.ipynb` |
| Next.js 화면 | `web/app/page.tsx` |
| 검색 API | `web/app/api/search/route.ts` |
| Supabase 서버 클라이언트 | `web/lib/supabase.ts` |
| Gemini embedding 클라이언트 | `web/lib/gemini.ts` |
| RPC SQL | `Database/RPC_match_announcements_hybrid_v1.sql` |
| RPC 계약 | `Database/RPC_contract_v1.md` |

## 현재 포함 범위

- 자연어 검색 화면
- 카테고리/지역/나이/모집상태 필터
- 결과 카드
- 대상 연령 표시 보정
- 회원가입/로그인 API
- 저장 필터 API/UI
- 스크랩 API/UI

## 제외 범위

아래는 현재 Next.js 최소 완성 범위가 아니다.

- LLM 조건 자동 추출
- 추천 이유 생성
- 챗봇/RAG 답변
- PDF/HWP 첨부파일 본문 RAG

## 팀 확인 필요
1. 실제 Supabase에 users, user_info, user_filters, scraps 테이블이 생성되어 있는지
2. announcements가 main_v1_1_9.csv 기준으로 적재되어 있는지
   - auto_main_v1_1_8_20260503.csv와 main_v1_1_9.csv는 둘 다 565건이지만 region 정규화 차이가 있어서 같은 데이터가 아님
3. announcements 565건 중 embedding 컬럼이 비어 있는 공고가 0건인지
4. match_announcements_hybrid RPC가 최신 SQL 기준으로 등록되어 있고, 직접 실행했을 때 결과가 나오는지
5. Vercel 배포 환경변수는 로컬 .env와 같은 값으로 쓰면 되는지