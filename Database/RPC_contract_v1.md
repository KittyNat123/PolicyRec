# RPC Contract v1

## 목적

Next.js 검색 API와 챗봇/RAG 로직이 Supabase RPC를 호출할 때 사용할 인터페이스를 정의한다.

## RPC 이름

함수명: `match_announcements_hybrid`

기존 단순 벡터 검색 RPC인 `match_announcements`와 구분하기 위해 새 이름을 사용한다.

## 입력 파라미터

| name | type | required | 설명 |
|---|---|---:|---|
| query_embedding | vector(768) | yes | 사용자 질문을 Gemini embedding으로 변환한 벡터 |
| match_threshold | float | no | 유사도 최소 기준. 생략 시 DB 기본값 0.2 |
| match_count | int | no | 반환 개수. 생략 시 DB 기본값 10 |
| filter_category | text | no | `announcements.s_category` 필터 |
| filter_region | text | no | `announcements.region` 필터 |
| user_age | int | no | 사용자 나이. NULL이면 나이 필터 미적용 |

주의:
- `active_only`는 RPC 파라미터로 받지 않는다.
- 진행중/마감 여부는 반환된 `apply_end_dt`를 기준으로 Next.js/front에서 계산한다.

## 필터 규칙

카테고리:
- `filter_category`가 NULL이면 필터를 적용하지 않는다.
- `filter_category = '전체'`이면 필터를 적용하지 않는다.
- 그 외에는 `announcements.s_category = filter_category` 조건을 적용한다.

지역:
- DB의 `전국`은 실제 지역 값이다.
- UI의 `전체`는 DB 값이 아니라 필터 없음 의미이다.
- `filter_region`이 NULL이면 필터를 적용하지 않는다.
- `filter_region = '전체'`이면 필터를 적용하지 않는다.
- 특정 지역을 선택하면 해당 지역 공고와 `전국` 공고를 함께 반환한다.

나이:
- `user_age`가 NULL이면 나이 필터를 적용하지 않는다.
- `target_age_min`이 NULL이면 최소 나이 제한 없음으로 본다.
- `target_age_max`가 NULL이면 최대 나이 제한 없음으로 본다.

## 반환값

| name | 설명 |
|---|---|
| id | 공고 PK |
| source | 출처 |
| source_id | 원본 ID |
| title | 화면 표시용 제목 |
| summary | 요약 |
| provider | 제공 기관 |
| s_category | 서비스 표준 카테고리 |
| region | 지역 |
| target_age_min | 최소 나이. NULL은 제한 없음 |
| target_age_max | 최대 나이. NULL은 제한 없음 |
| apply_start_dt | 신청 시작일 |
| apply_end_dt | 신청 종료일 |
| target_group | 대상 |
| detail_url | 상세 URL |
| similarity | embedding 유사도 |

## Front 계산값

진행중/마감 여부는 DB에 저장하지 않고 Next.js/front에서 계산한다.

계산 기준:
- `apply_end_dt`가 NULL이면 `상시/확인필요`로 보고 진행중 처리한다.
- 마감일은 KST 기준 날짜로 비교한다.
- 마감일 당일은 진행중으로 본다. 즉 inclusive 비교를 사용한다.
- 시간 단위 비교는 하지 않는다.
- CSV 원본 날짜에 시간이 없으면 DB/화면에서 `00:00:00`으로 보일 수 있다.
- 이 `00:00:00`은 "마감일 시작 시각에 마감"이라는 뜻이 아니라, 날짜형 값이 timestamp 컬럼에 저장되며 붙은 기본 시간이다.
- 따라서 `apply_end_dt < now()` 같은 timestamp 비교로 진행중/마감을 판단하지 않는다.
- 반드시 KST 날짜 키(`YYYY-MM-DD`)끼리 비교한다.

예시:
- 오늘이 2026-04-29이고 `apply_end_dt`가 2026-04-29이면 `진행중`
- 오늘이 2026-04-30이고 `apply_end_dt`가 2026-04-29이면 `마감`

Next.js 구현 예시:

```ts
const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toKstDateKey(value: string | Date) {
  return kstDateFormatter.format(
    typeof value === "string" ? new Date(value) : value
  );
}

export function getPolicyStatus(applyEndDt: string | null) {
  if (!applyEndDt) {
    return {
      isActive: true,
      label: "상시/확인필요",
    };
  }

  const today = toKstDateKey(new Date());
  const endDate = toKstDateKey(applyEndDt);

  return {
    isActive: endDate >= today,
    label: endDate >= today ? "진행중" : "마감",
  };
}
```


## CSV to DB 매핑

| CSV | DB |
|---|---|
| title | title |
| s_category | s_category |
| apply_start | apply_start_dt |
| apply_end | apply_end_dt |
| target_age_min | target_age_min |
| target_age_max | target_age_max |

주의: CSV의 `category`는 원 API 카테고리이므로 서비스 필터에는 사용하지 않는다.
