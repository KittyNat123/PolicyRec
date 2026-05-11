import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { dDayLabel, recruitmentStatus } from "@/lib/utils";

type AnnouncementLite = {
  id: number;
  title: string | null;
  summary: string | null;
  s_category: string | null;
  region: string | null;
  apply_end_dt: string | null;
  detail_url: string | null;
};

type ScrapWithAnnouncement = {
  scrap_id: number;
  created_dt: string;
  ann_id: number;
  announcements: AnnouncementLite | AnnouncementLite[] | null;
};

function pickAnnouncement(
  value: ScrapWithAnnouncement["announcements"]
): AnnouncementLite | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isUrgentByEndDate(applyEnd: string | null): boolean {
  if (!applyEnd) return false;
  const dday = dDayLabel(applyEnd);
  if (dday === "D-day") return true;
  if (!dday.startsWith("D-")) return false;
  const days = Number(dday.slice(2));
  return Number.isInteger(days) && days >= 1 && days <= 7;
}

export async function GET(request: NextRequest) {
  const loginId = getLoginIdFromRequest(request);
  if (!loginId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = 5;

  // 1. Fetch all scraps for the user with announcement details
  const { data, error } = await supabase
    .from("scraps")
    .select(`
      scrap_id,
      created_dt,
      ann_id,
      announcements (
        id,
        title,
        summary,
        s_category,
        region,
        apply_end_dt,
        detail_url
      )
    `)
    .eq("login_id", loginId);

  if (error) {
    return NextResponse.json({ error: "스크랩 내역을 불러오지 못했습니다." }, { status: 500 });
  }

  // 2. Map and determine urgency
  const formattedScraps = ((data ?? []) as ScrapWithAnnouncement[]).map((row) => {
    const ann = pickAnnouncement(row.announcements);
    const applyEnd = ann?.apply_end_dt ?? null;
    const isClosed = recruitmentStatus(null, applyEnd) === "마감";
    const isUrgent = !isClosed && isUrgentByEndDate(applyEnd);

    return {
      scrap_id: row.scrap_id,
      ann_id: row.ann_id,
      scrapped_at: row.created_dt,
      title: ann?.title || "제목 없음",
      summary: ann?.summary || null,
      s_category: ann?.s_category || null,
      region: ann?.region || null,
      detail_url: ann?.detail_url || "#",
      apply_end_dt: applyEnd,
      is_urgent: isUrgent,
      is_closed: isClosed,
    };
  });

  // 3. Sort: Urgent first, then by scrapped date descending
  formattedScraps.sort((a, b) => {
    // 1st priority: Urgent items first
    if (a.is_urgent && !b.is_urgent) return -1;
    if (!a.is_urgent && b.is_urgent) return 1;
    
    // 2nd priority: Recently scrapped first
    return new Date(b.scrapped_at).getTime() - new Date(a.scrapped_at).getTime();
  });

  // 4. Pagination
  const totalCount = formattedScraps.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const startIdx = (page - 1) * pageSize;
  const paginatedScraps = formattedScraps.slice(startIdx, startIdx + pageSize);

  return NextResponse.json({
    scraps: paginatedScraps,
    totalCount,
    totalPages,
    currentPage: page
  });
}
