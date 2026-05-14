# 이미지 2: PolicyRec 파일/기능 연관 구조

## 목적

사용자 기능이 어떤 Next.js 화면/API와 연결되고, 어떤 Supabase 테이블/RPC를 사용하는지 한눈에 보여줌. 발표자가 설명할 핵심 연결만 표시.

---

## Mermaid 다이어그램

```mermaid
flowchart TB
    subgraph User["👤 사용자 기능"]
        U1["통합검색"]
        U2["조건검색"]
        U3["스크랩"]
        U4["맞춤 추천"]
        U5["챗봇 추천"]
    end

    subgraph Frontend["🖥️ Next.js Frontend"]
        F1["page.tsx<br/>(메인 + 검색)"]
        F2["scraps/page.tsx<br/>(스크랩 페이지)"]
    end

    subgraph API["⚙️ Next.js API Route"]
        A1["api/search<br/>(통합/조건검색)"]
        A2["api/mypage/scraps<br/>(스크랩 토글)"]
        A3["api/mypage/recommendations<br/>(맞춤 추천)"]
        A4["api/chat/rag<br/>(챗봇)"]
    end

    subgraph External["🤖 External"]
        E1["Gemini<br/>embedding + 답변"]
    end

    subgraph DB["🗄️ Supabase"]
        D1["announcements<br/>(공고 데이터 + embedding)"]
        D2["user_info<br/>(프로필)"]
        D3["scraps<br/>(스크랩 이력)"]
        D4["chat_history<br/>(대화 저장)"]
        R1[["match_announcements_hybrid<br/>(RPC)"]]
    end

    U1 --> F1
    U2 --> F1
    U3 --> F1
    U3 --> F2
    U4 --> F1
    U5 --> F1

    F1 --> A1
    F1 --> A2
    F1 --> A3
    F1 --> A4
    F2 --> A2

    A1 --> E1
    A1 --> R1
    A1 --> D1

    A2 --> D3
    A2 --> D1

    A3 --> D2
    A3 --> D3
    A3 --> R1
    A3 --> D1

    A4 --> E1
    A4 --> D2
    A4 --> R1
    A4 --> D1
    A4 --> D4

    R1 --> D1
```

---

## 핵심 메시지

**사용자 기능은 Next.js 화면과 API Route를 거쳐 Supabase 테이블과 RPC로 연결되고, 응답 결과는 다시 화면으로 돌아옵니다.**

- 통합검색: 검색어 → Gemini embedding → pgvector RPC → 공고 검색 → 카드 렌더링
- 조건검색: 사용자 조건 → API → DB hard filter → 적합도 정렬 → 카드 렌더링
- 스크랩: 사용자 토글 → API → `scraps` 테이블 저장/삭제
- 맞춤 추천: `user_info` + `scraps` → RPC + 유사도 → 추천 결과 → 메인/스크랩 페이지
- 챗봇: 질문 + `user_info` + 대화 맥락 → RPC + Gemini 답변 → `chat_history` 저장 → 답변 표시

> ℹ️ 위 다이어그램은 데이터 요청 흐름을 보여줍니다. 결과 응답은 반대 방향으로 흘러 사용자 화면에 표시됩니다.

---

## 단순화 버전 (PPT 슬라이드용)

복잡한 위 도식이 부담스러우면 아래 단순화 버전 사용:

```mermaid
flowchart LR
    U["사용자 기능<br/>통합검색<br/>조건검색<br/>스크랩<br/>맞춤추천<br/>챗봇"]
    F["Next.js<br/>화면 + API Route"]
    DB["Supabase<br/>announcements<br/>user_info<br/>scraps<br/>chat_history"]
    AI["Gemini<br/>embedding<br/>답변 생성"]

    U <--> F
    F <--> DB
    F <--> AI
```
