import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const CATEGORIES = [
  "창업", "경영", "기술", "인력/일자리", "판로/수출",
  "자금", "교육/멘토링", "시설/공간", "행사/네트워크",
  "주거", "복지/문화", "기타",
];

async function isAdmin(loginId: string): Promise<boolean> {
  if (loginId === "admin") return true;
  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("login_id", loginId)
    .maybeSingle();
  return data?.role === "admin";
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId || !(await isAdmin(loginId))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // 모집중 정의: recruitmentStatus(utils.ts)와 동일하게 맞춤
  // - apply_end_dt가 NULL이면 "상시"로 별도 분류 (모집중에 포함하지 않음)
  // - apply_end_dt < today면 "마감"
  // - apply_start_dt가 미래면 "모집예정"
  // - 그 외(시작·마감 사이)가 "모집중"
  const [
    totalResult,
    openResult,
    standingResult,
    embeddedResult,
    categoryResults,
  ] = await Promise.all([
    // 전체 공고 수
    supabase.from("announcements").select("id", { count: "exact", head: true }),
    // 모집중: 마감일 존재 + 마감일 미경과 + (시작일 없음 OR 시작일 도래)
    supabase
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .not("apply_end_dt", "is", null)
      .gte("apply_end_dt", today)
      .or(`apply_start_dt.is.null,apply_start_dt.lte.${today}`),
    // 상시: 마감일이 NULL
    supabase
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .is("apply_end_dt", null),
    // 임베딩 완료 수
    supabase
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .not("embedding", "is", null),
    // 카테고리별 공고 수 (병렬)
    Promise.all(
      CATEGORIES.map(async (cat) => {
        const { count } = await supabase
          .from("announcements")
          .select("id", { count: "exact", head: true })
          .eq("s_category", cat);
        return { category: cat, count: count ?? 0 };
      })
    ),
  ]);

  const total = totalResult.count ?? 0;
  const open = openResult.count ?? 0;
  const standing = standingResult.count ?? 0;
  const embedded = embeddedResult.count ?? 0;

  const topCategories = categoryResults
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return NextResponse.json({
    total,
    open,
    standing,
    embeddingRatio: total > 0 ? Math.round((embedded / total) * 100) : 0,
    embeddingCount: embedded,
    topCategories,
  });
}
