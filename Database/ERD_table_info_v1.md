# 📌 데이터 구조 및 활용 정리 (최종본)

## 테이블 관계 (Relationship)
- **users (1) ↔ user_info (1):** 사용자 식별 정보와 추천용 프로필 정보의 1:1 결합
- **users (1) ↔ scraps (N) ↔ announcements (1):** 사용자가 관심 있는 정책을 저장하는 연결 고리
- **users (1) ↔ chat_history (N):** 사용자의 과거 상담 내역 추적 및 문맥 유지
- **announcements (Core):** 모든 서비스(검색, 추천, 챗봇)가 참조하는 가장 핵심적인 데이터 허브

---

## A. users (사용자 계정)
**역할:** 사용자 인증 및 시스템 식별의 핵심 테이블
- `user_account_id` (UUID): 내부 시스템용 고유 고정 ID (PK)
- `login_id` (VARCHAR): 사용자 로그인 계정명 (Unique, FK 참조용)
- `email` (VARCHAR): 계정 이메일 주소 (Unique)
- `password_hash` (TEXT): PBKDF2 알고리즘으로 암호화된 비밀번호
- `role` (TEXT): 사용자 권한 구분 (기본값: 'user')
- `created_dt` (TIMESTAMP): 계정 생성 일시

---

## B. user_info (사용자 프로필)
**역할:** 개인화 추천 및 검색 필터 보조를 위한 상세 프로필 정보
- `login_id` (VARCHAR): 사용자 ID (PK, users 테이블 참조)
- `name` (TEXT): 사용자 실명
- `nickname` (VARCHAR): 서비스 내 활동 별명
- `user_type` (VARCHAR): 사용자 유형 (예: 대학생, 예비 창업자 등)
- `age_group` (TEXT): 연령 정보 (예: "25")
- `phone` (VARCHAR): 연락처 정보
- `regions` (TEXT[]): 관심 지역 리스트 (배열 형태)
- `categories` (TEXT[]): 관심 정책 분야 리스트 (배열 형태)
- `created_dt` (TIMESTAMP): 프로필 최초 생성 일시
- `updated_dt` (TIMESTAMP): 프로필 마지막 수정 일시

---

## C. announcements (통합 정책 공고)
**역할:** 검색, 추천, 챗봇 RAG 엔진의 중심이 되는 핵심 데이터 저장소
- `id` (BIGINT): 공고 고유 번호 (PK)
- `source` (TEXT): 수집 출처 구분 (youth: 온통청년, kst: K-Startup, biz: 기업마당)
- `source_id` (TEXT): 원본 API에서 제공하는 고유 ID
- `title` (TEXT): 정책 공고 제목
- `summary` (TEXT): 공고 핵심 요약 내용
- `provider` (TEXT): 정책 제공 기관
- `norm_title` (TEXT): 검색 최적화를 위해 정규화된 제목
- `norm_provider` (TEXT): 정규화된 제공 기관명
- `norm_period` (TEXT): 정규화된 신청 기간 안내 문구
- `s_category` (TEXT): 시스템 표준 카테고리 (필터링 핵심 컬럼)
- `region` (TEXT): 해당 정책의 대상 지역
- `target_age_min` (INT): 지원 대상 최소 연령
- `target_age_max` (INT): 지원 대상 최대 연령
- `apply_start_dt` (TIMESTAMP): 신청 시작 일시
- `apply_end_dt` (TIMESTAMP): 신청 종료 일시
- `target_group` (TEXT): 주요 지원 대상 설명
- `target_tags` (TEXT[]): 정책 키워드 태그 리스트
- `detail_url` (TEXT): 원본 공고 상세 페이지 링크
- `support_type` (TEXT): 지원 형태 (현금, 바우처 등)
- `required_documents` (TEXT): 제출 필요 서류 목록
- `application_method` (TEXT): 신청 방법 안내
- `additional_conditions` (TEXT): 기타 유의사항 및 추가 조건
- `content` (TEXT): 임베딩 생성을 위한 통합 텍스트 데이터
- `embedding` (VECTOR): 768차원 벡터 데이터 (Gemini-embedding-001 기반)
- `created_dt/updated_dt`: 데이터 적재 및 수정 일시
- `_scope, _scope_reason` : text타입으로 존재하나 서비스에 필요한 컬럼은 아님
---

## D. scraps (스크랩)
**역할:** 사용자별 관심 공고 저장 내역 관리
- `scrap_id` (BIGINT): 스크랩 고유 번호 (PK)
- `login_id` (VARCHAR): 스크랩한 사용자 ID (users 참조)
- `ann_id` (BIGINT): 스크랩된 공고 ID (announcements 참조)
- `created_dt` (TIMESTAMP): 스크랩 일시
- **제약사항:** 동일 사용자가 같은 공고를 중복 스크랩할 수 없음 (Unique Constraint)

---

## E. chat_history (챗봇 대화 이력)
**역할:** 챗봇 상담 내역 저장 및 연속성 있는 대화 세션 관리
- `chat_id` (BIGINT): 대화 기록 고유 번호 (PK)
- `login_id` (VARCHAR): 질문한 사용자 ID (users 참조)
- `user_query` (TEXT): 사용자의 질문 내용
- `ai_response` (TEXT): 시스템(Gemini)의 답변 내용
- `session_id` (TEXT): 대화 그룹화를 위한 세션 고유값
- `created_dt` (TIMESTAMP): 대화 발생 일시
- `query_embedding` (VECTOR): 사용자의 질문 벡터 (768차원, Gemini-embedding-001 기반) -> 현재 사용하지 않음!

