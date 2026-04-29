# 📌 데이터 구조 및 활용 정리

## A. users / user_info (계정 + 프로필)

**역할:** 사용자 식별 및 개인화의 시작점

- `user_account_id` (☑️수정됨)  
  - 내부 시스템용 고유 ID (PK)
  - 장기적으로 사용자 관련 테이블의 연결 기준으로 사용하는 것을 권장
  - 단, 현재 MVP SQL 스키마에서는 `scraps`, `user_filters`, `chat_history`가 `login_id`를 FK로 사용한다
  - 따라서 현재 MVP 구현과 쿼리는 `login_id` 기준으로 맞춘다

- `login_id`  
  - 사용자 로그인 계정명  
  - 외부 노출 ID

- `interest_keywords`  
  - 사용자 관심사 키워드  
  - 사용자 직접 입력
  - 초기 추천 및 필터 보조에 활용

---

## B. announcements (공고 데이터 / RAG 핵심)

**역할:** 여러 출처(youth, kst, biz)에서 수집된 공고를 통합 관리. 검색, 추천, 챗봇의 중심 데이터

- `embedding`  
  - 텍스트를 벡터화한 768차원 데이터 (Gemini 생성)  
  - 유사도 검색, 추천, 챗봇 RAG의 핵심

- `unique_source_item` 유니크키 제약조건 (☑️수정됨)  
  - 중복 방지 기준은 `announcements(source, source_id)` 조합이다
  - `source`는 수집 출처(`biz`, `kst`, `youth`)이고, `source_id`는 원본 API의 고유 ID이다
  - 현재 DB 스키마에는 `source_name` 컬럼이 없다


👉 텍스트 → 벡터 → 유사도 기반 검색 구조

---

## C. api_batch_logs (API 배치 로그)

**역할:** API 수집 및 적재 작업 로그 기록. 관리자 페이지에서 api 수집 현황 조회(수집 지연시 상태 확인 가능)

- `source`  
  - 수집 출처

- `status`  
  - 실행 상태 (SUCCESS / FAIL)

- `total_count`  
  - 수집 시도 건수

- `inserted_count`  
  - 실제 적재 건수

- `error_message`  
  - 실패 시 에러 내용

- `execution_time_ms`  
  - 작업 소요 시간

---

**활용:**
- 배치 성공/실패 모니터링
- 데이터 누락 및 장애 원인 파악

---

**로그 전략:**

👉 방법 A (권장)  
- 시작 시 INSERT (status=RUNNING)  
- 종료 시 UPDATE (SUCCESS / FAIL)

👉 방법 B  
- 종료 후 INSERT (try/except 기반)

👉 특징:  
- 로그는 결과가 아니라 **시도부터 전체 과정 기록**

---

---
## D. scraps (스크랩)

**역할:** 사용자 관심 공고 저장

**활용:**
1. 스크랩한 공고들의 embedding 조회
2. 평균 벡터 생성
3. 사용자 취향 벡터 생성

👉 결과: 유사 공고 추천

**특징:**  
- 명시적 관심 데이터  
- 추천 정확도 높음

---

## E. user_filters (사용자 필터 저장)

**역할:** 검색 조건 저장

- 저장 항목: 검색시 사용되는 필터링 컬럼

**활용:**  
- "내 필터 검색" 클릭 시  
- 저장된 조건을 그대로 검색 쿼리에 적용

👉 반복 검색 최적화

---

## F. chat_history (챗봇 대화 기록)

**역할:** 사용자 질문 및 ai답변 요약 대화 로그 저장

- `query_embedding`  
  - 질문을 벡터화하여 저장

---

### 활용 흐름

1. 최근 질문(최근 5건) 데이터 추출
2. 각 질문 embedding 조회
3. 시간 기반 가중치 적용 (최근일수록 weight ↑)
4. 하나의 벡터로 통합

👉 결과:
- 최근 관심사 분석
- 맞춤형 정보 우선 노출

---

# 전체 추천 흐름

## 1. 초기 상태
- `interest_keywords` 기반 추천

## 2. 사용자 행동 데이터 축적
- 스크랩 → scraps
- 검색 → chat_history
- 필터 → user_filters

## 3. 추천 생성

- 스크랩 기반 → 취향 벡터
- 챗봇 기반 → 최근 관심 벡터

👉 두 벡터를 활용하여  
`announcements.embedding`과 유사도 검색 수행

---

