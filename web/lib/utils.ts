// =====================================================================
// 카드 표시용 유틸 함수 (Streamlit v3.2 패턴 이식)
// =====================================================================
// - 날짜 포맷
// - D-day 라벨
// - 모집 상태 계산 (KST 기준)
// - source 배지 / 모집 상태 배지 스타일
//
// Streamlit의 d_day_label / resolve_recruitment_status / SOURCE_BADGE_STYLES
// 와 동일 의미로 작성. 비교 기준은 모두 KST(Asia/Seoul) 날짜로 통일.
// (RPC_contract_v1.md 의 "마감일은 KST 날짜로 비교" 규칙)
// =====================================================================

const KST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Date 객체 → "YYYY-MM-DD" (KST 기준). 비교 시 항상 이 형식 사용. */
function toKstDateKey(value: Date): string {
  return KST_FORMATTER.format(value);
}

/** 두 KST 날짜 키의 차이를 일 단위로 반환. 양수면 미래, 음수면 과거. */
function diffDaysKst(targetKey: string, fromKey: string): number {
  // "YYYY-MM-DD" → ms (각 시점을 자기 자신의 자정으로 해석)
  const t = new Date(targetKey + "T00:00:00").getTime();
  const f = new Date(fromKey + "T00:00:00").getTime();
  return Math.round((t - f) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------
// 날짜 포맷 — 카드의 "마감: 2026.06.30" 표시용
// ---------------------------------------------------------------------
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

// ---------------------------------------------------------------------
// D-day 라벨 — "D-7", "D-day", "마감", "상시/확인필요"
// ---------------------------------------------------------------------
export function dDayLabel(applyEnd: string | null | undefined): string {
  if (!applyEnd) return "상시/확인필요";
  const end = new Date(applyEnd);
  if (isNaN(end.getTime())) return "확인필요";
  const today = toKstDateKey(new Date());
  const endKey = toKstDateKey(end);
  const diff = diffDaysKst(endKey, today);
  if (diff < 0) return "마감";
  if (diff === 0) return "D-day";
  return `D-${diff}`;
}

// ---------------------------------------------------------------------
// 모집 상태 — Streamlit resolve_recruitment_status 와 동일 규칙
// ---------------------------------------------------------------------
export type RecruitmentStatus =
  | "모집중"
  | "마감"
  | "모집예정"
  | "상시";

export function recruitmentStatus(
  applyStart: string | null | undefined,
  applyEnd: string | null | undefined
): RecruitmentStatus {
  if (!applyEnd) return "상시"; // 마감일 없으면 상시
  const end = new Date(applyEnd);
  if (isNaN(end.getTime())) return "상시";

  const today = toKstDateKey(new Date());
  const endKey = toKstDateKey(end);

  // 1) 마감일이 오늘보다 이전 → "마감"
  if (endKey < today) return "마감";

  // 2) 시작일이 미래 → "모집예정"
  if (applyStart) {
    const start = new Date(applyStart);
    if (!isNaN(start.getTime())) {
      const startKey = toKstDateKey(start);
      if (startKey > today) return "모집예정";
    }
  }

  // 3) 그 외 → "모집중"
  // 마감 임박 여부는 상태로 분리하지 않고 D-day 라벨로 표시합니다.
  return "모집중";
}

// ---------------------------------------------------------------------
// 대상 연령 표시 — "만 20세 ~ 만 39세", "만 40세 이상", "연령 확인 필요"
// ---------------------------------------------------------------------
export function formatTargetAgeRange(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  const hasMin = typeof min === "number" && Number.isFinite(min);
  const hasMax = typeof max === "number" && Number.isFinite(max);

  if (hasMin && hasMax) {
    // ☑️수정: 저장된 연령값은 보정하지 않고, 뒤집힌 범위만 비정상 표시로 분리
    if (min > max) return "연령 확인 필요";
    if (min === max) return `만 ${min}세`;
    return `만 ${min}세 ~ 만 ${max}세`;
  }
  if (hasMin) return `만 ${min}세 이상`;
  if (hasMax) return `만 ${max}세 이하`;
  return "연령 확인 필요";
}

// ---------------------------------------------------------------------
// source별 배지 스타일 (Tailwind 클래스)
// ---------------------------------------------------------------------
export const SOURCE_BADGE_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  biz: {
    bg: "bg-purple-100 dark:bg-purple-900/40",
    text: "text-purple-700 dark:text-purple-300",
    label: "Bizinfo",
  },
  kst: {
    bg: "bg-orange-100 dark:bg-orange-900/40",
    text: "text-orange-700 dark:text-orange-300",
    label: "K-Startup",
  },
  youth: {
    bg: "bg-cyan-100 dark:bg-cyan-900/40",
    text: "text-cyan-700 dark:text-cyan-300",
    label: "온통청년",
  },
};

export function getSourceBadge(
  source: string | null | undefined
): { bg: string; text: string; label: string } | null {
  if (!source) return null;
  return (
    SOURCE_BADGE_STYLES[source] ?? {
      bg: "bg-zinc-100 dark:bg-zinc-800",
      text: "text-zinc-700 dark:text-zinc-300",
      label: source,
    }
  );
}

// ---------------------------------------------------------------------
// 모집 상태별 배지 스타일
// ---------------------------------------------------------------------
export const STATUS_BADGE_STYLES: Record<
  RecruitmentStatus,
  { bg: string; text: string }
> = {
  모집중: {
    bg: "bg-green-100 dark:bg-green-900/40",
    text: "text-green-700 dark:text-green-300",
  },
  마감: {
    bg: "bg-zinc-200 dark:bg-zinc-700",
    text: "text-zinc-600 dark:text-zinc-400",
  },
  모집예정: {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-700 dark:text-blue-300",
  },
  상시: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
  },
};
