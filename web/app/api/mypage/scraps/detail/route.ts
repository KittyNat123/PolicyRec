import { NextRequest, NextResponse } from "next/server";
import { getLoginIdFromRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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

  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 2. Map and determine urgency
  const formattedScraps = (data || []).map((row: any) => {
    const ann = row.announcements || {};
    let isUrgent = false;
    let isClosed = false;

    if (ann.apply_end_dt) {
      const endDate = new Date(ann.apply_end_dt);
      if (endDate < now) {
        isClosed = true;
      } else if (endDate <= nextWeek) {
        isUrgent = true;
      }
    }

    return {
      scrap_id: row.scrap_id,
      ann_id: row.ann_id,
      scrapped_at: row.created_dt,
      title: ann.title || "제목 없음",
      summary: ann.summary || null,
      s_category: ann.s_category || null,
      region: ann.region || null,
      detail_url: ann.detail_url || "#",
      apply_end_dt: ann.apply_end_dt,
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
